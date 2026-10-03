<?php
// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fullbleed\CommercePro\CustomerDownloads;
defined( 'ABSPATH' ) || exit;

const ACTION = 'fullbleed_customer_summary';
const RETRY_SECONDS = 30;

add_filter( 'woocommerce_my_account_my_orders_actions', __NAMESPACE__ . '\order_actions', 20, 2 );
add_action( 'admin_post_' . ACTION, __NAMESPACE__ . '\download' );
add_action( 'admin_post_nopriv_' . ACTION, __NAMESPACE__ . '\download' );
add_action( 'woocommerce_admin_order_data_after_order_details', __NAMESPACE__ . '\order_status' );

function eligible( $order ) {
    $config = \Fullbleed\CommercePro\Automation\settings();
    return $config['customer_downloads'] && \Fullbleed\CommercePro\Automation\connected( $config )
        && function_exists( '\Fullbleed\Commerce\get_order' ) && class_exists( '\WC_Rate_Limiter' )
        && get_current_user_id() > 0 && is_a( $order, '\WC_Order' )
        && (int) $order->get_customer_id() === get_current_user_id()
        && $order->has_status( array( 'processing', 'completed' ) )
        && (float) $order->get_total_refunded() <= 0;
}

function order_actions( $actions, $order ) {
    if ( eligible( $order ) ) {
        $actions['fullbleed-summary'] = array(
            'url' => add_query_arg( array( 'action' => ACTION, 'order_id' => $order->get_id(), '_wpnonce' => wp_create_nonce( ACTION . '_' . $order->get_id() ) ), admin_url( 'admin-post.php' ) ),
            'name' => __( 'Order summary PDF', 'fullbleed-commerce-pro' ),
            /* translators: %s: order number */
            'aria-label' => sprintf( __( 'Download order summary PDF for order %s', 'fullbleed-commerce-pro' ), $order->get_order_number() ),
        );
    }
    return $actions;
}

function unavailable( $status, $message ) {
    $url = function_exists( 'wc_get_account_endpoint_url' ) ? wc_get_account_endpoint_url( 'orders' ) : home_url( '/' );
    wp_die( esc_html( $message ) . '<p><a href="' . esc_url( $url ) . '">' . esc_html__( 'Return to your account', 'fullbleed-commerce-pro' ) . '</a></p>', esc_html__( 'Order document', 'fullbleed-commerce-pro' ), array( 'response' => $status ) );
}

function download() {
    // Apply these to errors too. A nonce is CSRF protection, never ownership.
    nocache_headers();
    header( 'Cache-Control: no-store, private, max-age=0' );
    header( 'Referrer-Policy: no-referrer' );
    header( 'X-Content-Type-Options: nosniff' );
    header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
    if ( 'GET' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
        header( 'Allow: GET' );
        unavailable( 405, __( 'Open the document from your account orders page.', 'fullbleed-commerce-pro' ) );
    }
    $raw_id = $_GET['order_id'] ?? '';
    $id = is_string( $raw_id ) && preg_match( '/^[1-9][0-9]*$/D', $raw_id ) ? filter_var( $raw_id, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) ) : false;
    $nonce = isset( $_GET['_wpnonce'] ) && is_string( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';
    if ( ! is_user_logged_in() || ! $id || ! wp_verify_nonce( $nonce, ACTION . '_' . $id ) ) {
        unavailable( 403, __( 'Please sign in and refresh your account orders page before downloading.', 'fullbleed-commerce-pro' ) );
    }
    $order = function_exists( 'wc_get_order' ) ? wc_get_order( $id ) : false;
    if ( ! eligible( $order ) ) {
        unavailable( 404, __( 'This order document is unavailable.', 'fullbleed-commerce-pro' ) );
    }
    // WooCommerce's per-customer cooldown reduces repeated clicks. The renderer
    // also bounds site-wide concurrency/capacity; this is not an atomic quota.
    $rate_key = ACTION . '_' . get_current_user_id();
    if ( \WC_Rate_Limiter::retried_too_soon( $rate_key ) ) {
        header( 'Retry-After: ' . RETRY_SECONDS );
        unavailable( 429, __( 'Please wait 30 seconds before requesting another PDF.', 'fullbleed-commerce-pro' ) );
    }
    if ( ! \WC_Rate_Limiter::set_rate_limit( $rate_key, RETRY_SECONDS ) ) {
        unavailable( 503, __( 'Your PDF is temporarily unavailable. Please try again shortly.', 'fullbleed-commerce-pro' ) );
    }
    $pdf = \Fullbleed\CommercePro\Automation\render_document( $order, 'order-summary' );
    // Recheck the current order and opt-in after the remote operation. Never
    // return bytes when a refund, reassignment or disconnect was observed.
    wp_cache_delete( \Fullbleed\CommercePro\Automation\OPTION, 'options' );
    $order = wc_get_order( $id );
    if ( ! eligible( $order ) ) unavailable( 404, __( 'This order document is unavailable.', 'fullbleed-commerce-pro' ) );
    $order->update_meta_data( '_fullbleed_customer_download_result', array( 'state' => is_wp_error( $pdf ) ? 'failed' : 'prepared', 'code' => is_wp_error( $pdf ) ? sanitize_key( $pdf->get_error_code() ) : 'pdf_prepared', 'time' => gmdate( 'c' ) ) );
    $order->save_meta_data();
    \Fullbleed\CommercePro\Activity\record( $order, 'customer', 'my-account', 'order-summary', is_wp_error( $pdf ) ? 'failed' : 'ready', is_wp_error( $pdf ) ? $pdf->get_error_code() : 'pdf_prepared' );
    if ( is_wp_error( $pdf ) ) {
        header( 'Retry-After: ' . RETRY_SECONDS );
        unavailable( 503, __( 'Your PDF is temporarily unavailable. Please try again shortly.', 'fullbleed-commerce-pro' ) );
    }
    header( 'Content-Type: application/pdf' );
    header( 'Content-Disposition: attachment; filename="order-summary-' . $id . '.pdf"' );
    header( 'Content-Length: ' . strlen( $pdf ) );
    echo $pdf; exit; // Renderer signature, size and digest verified in memory.
}

function order_status( $order ) {
    if ( ! current_user_can( 'edit_shop_order', $order->get_id() ) ) return;
    $result = $order->get_meta( '_fullbleed_customer_download_result' );
    if ( ! is_array( $result ) || 'failed' !== ( $result['state'] ?? '' ) ) return;
    echo '<p class="form-field form-field-wide"><strong>Fullbleed:</strong> ' . esc_html__( 'A customer PDF could not be prepared. Check the renderer connection and saved template in Fullbleed automation.', 'fullbleed-commerce-pro' ) . ' <small>' . esc_html( $result['time'] ?? '' ) . '</small></p>';
}
