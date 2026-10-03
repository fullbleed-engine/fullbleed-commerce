<?php
// Disposable Docker fixture only. This file is never shipped in either plugin.
if ( '1' !== getenv( 'FULLBLEED_NATIVE_FIXTURE' ) ) exit( 1 );
define( 'WP_INSTALLING', true );
require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
add_filter( 'pre_wp_mail', '__return_true' );
if ( ! is_blog_installed() ) wp_install( 'Cedar & Form', 'admin', 'admin@example.test', false, '', 'fullbleed-local-test' );
update_option( 'woocommerce_allow_tracking', 'no' );
update_option( 'woocommerce_custom_orders_table_enabled', 'yes' );
foreach ( array( 'woocommerce/woocommerce.php', 'fullbleed-commerce/fullbleed-commerce.php', 'fullbleed-commerce-pro/fullbleed-commerce-pro.php' ) as $plugin ) {
    $result = activate_plugin( $plugin );
    if ( is_wp_error( $result ) ) throw new RuntimeException( $result->get_error_message() );
}
echo json_encode( array( 'installed' => true ) );
