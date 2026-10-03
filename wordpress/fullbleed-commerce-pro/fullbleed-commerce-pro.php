<?php
/**
 * Plugin Name: Fullbleed Commerce Pro
 * Description: Automated order documents, customer downloads, additional designs and batch exports for Fullbleed Commerce.
 * Version: 0.1.2
 * Author: Fullbleed
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce, fullbleed-commerce
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: fullbleed-commerce-pro
 */

namespace Fullbleed\CommercePro;

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/automation.php';
require_once __DIR__ . '/customer-downloads.php';
require_once __DIR__ . '/activity.php';
require_once __DIR__ . '/alerts.php';
register_activation_hook( __FILE__, '\Fullbleed\CommercePro\Activity\install' );
register_deactivation_hook( __FILE__, '\Fullbleed\CommercePro\Activity\deactivate' );

add_action( 'admin_enqueue_scripts', function ( $hook ) {
    if ( 'woocommerce_page_fullbleed-commerce' === $hook ) {
        wp_enqueue_script( 'fullbleed-commerce-pro', plugins_url( 'assets/admin.js', __FILE__ ), array( 'fullbleed-commerce' ), '0.1.2', true );
    }
} );

add_action( 'before_woocommerce_init', function () {
    if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
    }
} );

add_filter( 'fullbleed_commerce_themes', function ( $themes ) {
    $themes[] = array( 'value' => 'contrast', 'label' => __( 'Contrast', 'fullbleed-commerce-pro' ) );
    $themes[] = array( 'value' => 'quiet', 'label' => __( 'Quiet', 'fullbleed-commerce-pro' ) );
    return $themes;
} );

add_filter( 'fullbleed_commerce_batch_limit', function () { return 25; } );
add_filter( 'fullbleed_commerce_client_extensions', function ( $extensions ) {
    $extensions[] = 'fullbleed-commerce-pro';
    return $extensions;
} );

function bulk_actions( $actions ) {
    $actions['fullbleed_documents'] = __( 'Create Fullbleed PDFs', 'fullbleed-commerce-pro' );
    return $actions;
}

function bulk_redirect( $redirect, $action, $ids ) {
    if ( 'fullbleed_documents' !== $action || ! current_user_can( 'edit_shop_orders' ) ) {
        return $redirect;
    }
    if ( count( $ids ) > 25 ) {
        wp_die( esc_html__( 'Select up to 25 orders per batch. No orders have been changed.', 'fullbleed-commerce-pro' ) );
    }
    return add_query_arg( array( 'page' => 'fullbleed-commerce', 'order_ids' => implode( ',', array_map( 'absint', $ids ) ) ), admin_url( 'admin.php' ) );
}

foreach ( array( 'edit-shop_order', 'woocommerce_page_wc-orders' ) as $screen ) {
    add_filter( 'bulk_actions-' . $screen, __NAMESPACE__ . '\bulk_actions' );
    add_filter( 'handle_bulk_actions-' . $screen, __NAMESPACE__ . '\bulk_redirect', 10, 3 );
}
