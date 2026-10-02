<?php
/**
 * Plugin Name: Fullbleed Commerce
 * Description: Designed order summaries and packing slips, generated privately in your browser.
 * Version: 0.1.0-alpha.1
 * Author: Fullbleed
 * Author URI: https://fullbleed.dev
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: fullbleed-commerce
 */

namespace Fullbleed\Commerce;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.1.0-alpha.1';

add_action( 'before_woocommerce_init', function () {
    if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
    }
} );

add_action( 'plugins_loaded', function () {
    if ( ! class_exists( '\WooCommerce' ) ) {
        return;
    }
    add_action( 'admin_menu', __NAMESPACE__ . '\admin_menu' );
    add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\assets' );
    add_action( 'rest_api_init', __NAMESPACE__ . '\routes' );
    add_action( 'woocommerce_admin_order_data_after_order_details', __NAMESPACE__ . '\order_link' );
} );

function admin_menu() {
    add_submenu_page( 'woocommerce', __( 'Fullbleed documents', 'fullbleed-commerce' ), __( 'Fullbleed documents', 'fullbleed-commerce' ), 'edit_shop_orders', 'fullbleed-commerce', __NAMESPACE__ . '\admin_page' );
}

function assets( $hook ) {
    if ( 'woocommerce_page_fullbleed-commerce' !== $hook ) {
        return;
    }
    wp_enqueue_style( 'fullbleed-commerce', plugins_url( 'assets/admin.css', __FILE__ ), array(), VERSION );
    wp_enqueue_script( 'fullbleed-commerce', plugins_url( 'assets/generated/admin.js', __FILE__ ), array(), VERSION, true );
}

function routes() {
    register_rest_route( 'fullbleed-commerce/v1', '/orders/(?P<id>[1-9]\d*)', array(
        'methods'             => \WP_REST_Server::READABLE,
        'callback'            => __NAMESPACE__ . '\get_order',
        'permission_callback' => __NAMESPACE__ . '\can_read_order',
        'args'                => array( 'id' => array( 'type' => 'integer', 'minimum' => 1, 'required' => true ) ),
    ) );
}

function can_read_order( $request ) {
    $id = absint( $request['id'] );
    return current_user_can( 'edit_shop_orders' ) && current_user_can( 'edit_shop_order', $id );
}

function plain( $value ) {
    return html_entity_decode( wp_strip_all_tags( (string) $value ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
}

function address( $order, $type ) {
    $data = $order->get_address( $type );
    $name = trim( ( $data['first_name'] ?? '' ) . ' ' . ( $data['last_name'] ?? '' ) );
    $lines = array_filter( array(
        $data['company'] ?? '',
        $data['address_1'] ?? '',
        $data['address_2'] ?? '',
        trim( ( $data['city'] ?? '' ) . ', ' . ( $data['state'] ?? '' ) . ' ' . ( $data['postcode'] ?? '' ), ' ,' ),
        WC()->countries->countries[ $data['country'] ?? '' ] ?? ( $data['country'] ?? '' ),
    ), 'strlen' );
    return array( 'name' => plain( $name ), 'lines' => array_values( array_map( __NAMESPACE__ . '\plain', $lines ) ) );
}

function get_order( $request ) {
    $order = wc_get_order( absint( $request['id'] ) );
    if ( ! $order || ! is_a( $order, '\WC_Order' ) || in_array( $order->get_status(), array( 'auto-draft', 'checkout-draft', 'trash' ), true ) ) {
        return new \WP_Error( 'fullbleed_order_missing', __( 'Order not found.', 'fullbleed-commerce' ), array( 'status' => 404 ) );
    }
    if ( (float) $order->get_total_refunded() > 0 || 'refunded' === $order->get_status() ) {
        return new \WP_Error( 'fullbleed_refund_unsupported', __( 'Refunded orders need a credit-note workflow and are not supported in this preview.', 'fullbleed-commerce' ), array( 'status' => 422 ) );
    }
    $items = array();
    foreach ( $order->get_items() as $item ) {
        $product = $item->get_product();
        $items[] = array(
            'name' => plain( $item->get_name() ),
            'sku' => $product ? plain( $product->get_sku() ) : '',
            'quantity' => (string) $item->get_quantity(),
            'total' => plain( $order->get_formatted_line_subtotal( $item ) ),
        );
    }
    $totals = array();
    foreach ( $order->get_order_item_totals() as $key => $row ) {
        $totals[] = array( 'label' => rtrim( plain( $row['label'] ), ': ' ), 'amount' => plain( $row['value'] ), 'emphasis' => 'order_total' === $key );
    }
    $base = wc_get_base_location();
    $store_lines = array_filter( array(
        get_option( 'woocommerce_store_address', '' ),
        get_option( 'woocommerce_store_address_2', '' ),
        trim( get_option( 'woocommerce_store_city', '' ) . ', ' . ( $base['state'] ?? '' ) . ' ' . get_option( 'woocommerce_store_postcode', '' ), ' ,' ),
        WC()->countries->countries[ $base['country'] ?? '' ] ?? '',
    ), 'strlen' );
    $shipping = address( $order, 'shipping' );
    if ( ! $shipping['name'] && ! $shipping['lines'] ) {
        $shipping = array( 'name' => __( 'No shipping address', 'fullbleed-commerce' ), 'lines' => array() );
    }
    $date = $order->get_date_created();
    $response = new \WP_REST_Response( array(
        'schema' => 'fullbleed.commerce-order.v1',
        'number' => (string) $order->get_order_number(),
        'date' => $date ? $date->date_i18n( 'M j, Y' ) : '',
        'status' => plain( wc_get_order_status_name( $order->get_status() ) ),
        'currency' => $order->get_currency(),
        'seller' => array( 'name' => plain( get_bloginfo( 'name' ) ), 'lines' => array_values( array_map( __NAMESPACE__ . '\plain', $store_lines ) ) ),
        'customer' => address( $order, 'billing' ),
        'shipping' => $shipping,
        'items' => $items,
        'totals' => $totals,
    ) );
    $response->header( 'Cache-Control', 'no-store, private, max-age=0' );
    return $response;
}

function order_link( $order ) {
    if ( ! current_user_can( 'edit_shop_order', $order->get_id() ) ) {
        return;
    }
    $url = add_query_arg( array( 'page' => 'fullbleed-commerce', 'order_ids' => $order->get_id() ), admin_url( 'admin.php' ) );
    echo '<p class="form-field form-field-wide"><a class="button" href="' . esc_url( $url ) . '">' . esc_html__( 'Create Fullbleed PDF', 'fullbleed-commerce' ) . '</a></p>';
}

function admin_page() {
    if ( ! current_user_can( 'edit_shop_orders' ) ) {
        wp_die( esc_html__( 'You cannot access order documents.', 'fullbleed-commerce' ) );
    }
    $themes = apply_filters( 'fullbleed_commerce_themes', array( array( 'value' => 'studio', 'label' => __( 'Studio', 'fullbleed-commerce' ) ) ) );
    $config = array(
        'endpoint' => rest_url( 'fullbleed-commerce/v1/orders' ),
        'nonce' => wp_create_nonce( 'wp_rest' ),
        'assets' => plugins_url( 'assets/generated/', __FILE__ ),
        'maxBatch' => min( 25, max( 1, (int) apply_filters( 'fullbleed_commerce_batch_limit', 1 ) ) ),
        'themes' => $themes,
    );
    // Query values select orders only. Every order is authorized again by the REST API.
    $ids = isset( $_GET['order_ids'] ) ? preg_replace( '/[^0-9,]/', '', sanitize_text_field( wp_unslash( $_GET['order_ids'] ) ) ) : '';
    ?>
    <div class="wrap" id="fullbleed-commerce" data-config="<?php echo esc_attr( wp_json_encode( $config ) ); ?>">
        <div class="fb-header"><span class="fb-wordmark">fullbleed<span>.</span></span><span class="fb-edition">COMMERCE / PREVIEW</span></div>
        <div class="fb-heading"><p class="fb-eyebrow"><?php esc_html_e( 'A GOOD ORDER DESERVES A GOOD DOCUMENT', 'fullbleed-commerce' ); ?></p><h1><?php esc_html_e( 'Make the last touch count.', 'fullbleed-commerce' ); ?></h1><p><?php esc_html_e( 'Designed order summaries and packing slips. Generated here, in your browser.', 'fullbleed-commerce' ); ?></p></div>
        <div class="fb-layout"><form class="fb-card">
            <h2><?php esc_html_e( 'Create your document', 'fullbleed-commerce' ); ?></h2>
            <label for="fb-orders"><?php esc_html_e( 'Order ID', 'fullbleed-commerce' ); ?></label>
            <input id="fb-orders" name="order_ids" type="text" inputmode="numeric" value="<?php echo esc_attr( substr( $ids, 0, 400 ) ); ?>" placeholder="1042" required maxlength="400">
            <p class="description"><?php echo esc_html( $config['maxBatch'] > 1 ? __( 'Enter up to 25 order IDs separated by commas. A batch downloads as one ZIP.', 'fullbleed-commerce' ) : __( 'Use the numeric ID from WooCommerce Orders.', 'fullbleed-commerce' ) ); ?></p>
            <label for="fb-kind"><?php esc_html_e( 'Document', 'fullbleed-commerce' ); ?></label>
            <select id="fb-kind" name="kind"><option value="order-summary"><?php esc_html_e( 'Order summary', 'fullbleed-commerce' ); ?></option><option value="packing-slip"><?php esc_html_e( 'Packing slip', 'fullbleed-commerce' ); ?></option></select>
            <div class="fb-row"><div><label for="fb-theme"><?php esc_html_e( 'Design', 'fullbleed-commerce' ); ?></label><select id="fb-theme" name="theme"><?php foreach ( $themes as $theme ) : ?><option value="<?php echo esc_attr( $theme['value'] ); ?>"><?php echo esc_html( $theme['label'] ); ?></option><?php endforeach; ?></select></div><div><label for="fb-paper"><?php esc_html_e( 'Paper', 'fullbleed-commerce' ); ?></label><select id="fb-paper" name="paper"><option value="A4">A4</option><option value="Letter">US Letter</option></select></div></div>
            <label for="fb-accent"><?php esc_html_e( 'Accent color', 'fullbleed-commerce' ); ?></label><input id="fb-accent" name="accent" type="color" value="#c5542d">
            <label for="fb-footer"><?php esc_html_e( 'Closing note', 'fullbleed-commerce' ); ?></label><textarea id="fb-footer" name="footer" rows="2" maxlength="500"><?php esc_html_e( 'Thank you for shopping with us.', 'fullbleed-commerce' ); ?></textarea>
            <button type="submit" class="button button-primary" data-render><?php esc_html_e( 'Generate PDF', 'fullbleed-commerce' ); ?></button>
            <p class="fb-status" data-status role="status" aria-live="polite"><?php esc_html_e( 'Ready when you are.', 'fullbleed-commerce' ); ?></p>
            <a class="button" data-preview hidden><?php esc_html_e( 'Download PDF', 'fullbleed-commerce' ); ?></a>
        </form><aside class="fb-card fb-note"><div class="fb-swatch"></div><h2><?php esc_html_e( 'Your store. Your documents.', 'fullbleed-commerce' ); ?></h2><p><?php esc_html_e( 'Order information travels only between your store and this browser. No Fullbleed account or hosted rendering service is needed.', 'fullbleed-commerce' ); ?></p><ul><li><?php esc_html_e( 'Store prices and totals are preserved.', 'fullbleed-commerce' ); ?></li><li><?php esc_html_e( 'Packing slips leave out prices.', 'fullbleed-commerce' ); ?></li><li><?php esc_html_e( 'PDFs use bundled fonts and vector type.', 'fullbleed-commerce' ); ?></li></ul><p class="description"><?php esc_html_e( 'Preview release: order summaries are not fiscal invoices. Refunds and automatic email attachments are not supported yet.', 'fullbleed-commerce' ); ?></p></aside></div>
    </div>
    <?php
}
