<?php
// Demo-only controls. Never installed in the distributed Fullbleed plugins.
defined( 'ABSPATH' ) || exit;
if ( ! defined( 'FULLBLEED_COMMERCE_DEMO' ) || true !== FULLBLEED_COMMERCE_DEMO ) {
    return;
}

// This sample store cannot deliver transactional messages or run queued jobs.
add_filter( 'pre_wp_mail', '__return_true' );
add_filter( 'woocommerce_allow_tracking', '__return_false' );

add_action( 'admin_init', function () {
    if ( ! current_user_can( 'manage_woocommerce' ) || ( $_GET['page'] ?? '' ) !== 'fullbleed-commerce' || isset( $_GET['order_ids'] ) ) {
        return;
    }
    $orders = get_option( 'fullbleed_demo_orders', array() );
    if ( $orders ) {
        wp_safe_redirect( add_query_arg( array( 'page' => 'fullbleed-commerce', 'order_ids' => absint( $orders[0] ) ), admin_url( 'admin.php' ) ) );
        exit;
    }
} );

add_action( 'admin_notices', function () {
    if ( ( $_GET['page'] ?? '' ) !== 'fullbleed-commerce' ) {
        return;
    }
    echo '<div class="notice notice-info" data-fullbleed-demo><p><strong>Your sample store is ready.</strong> Generate a PDF, then use <strong>Customize selected document</strong> to edit the design visually or paste HTML/CSS. Save and generate again to see your changes.</p><p>';
    foreach ( get_option( 'fullbleed_demo_orders', array() ) as $index => $order_id ) {
        $url = add_query_arg( array( 'page' => 'fullbleed-commerce', 'order_ids' => absint( $order_id ) ), admin_url( 'admin.php' ) );
        echo '<a class="button" href="' . esc_url( $url ) . '">' . esc_html( ( $index ? 'Long order #' : 'Sample order #' ) . $order_id ) . '</a> ';
    }
    $release_url = 'https://github.com/fullbleed-engine/fullbleed-commerce/releases/tag/v' . \Fullbleed\Commerce\VERSION;
    echo '</p><p>Disposable WordPress Playground demo with fictional orders. No store connection or payment is needed. Outgoing mail and WordPress networking are disabled. Use sample data only; export your template if you want to keep it.</p><p>The demo includes the free editor and browser PDFs. Pro email attachments and customer downloads need a separate server renderer and are not enabled here. <a href="' . esc_url( $release_url ) . '" target="_blank" rel="noopener noreferrer">Download the preview</a> · <a href="https://github.com/fullbleed-engine/fullbleed-commerce/blob/main/automation/README.md" target="_blank" rel="noopener noreferrer">Explore automation setup</a></p></div>';
} );
