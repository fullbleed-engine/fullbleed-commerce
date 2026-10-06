<?php
// Synthetic local development data only. Never run against a merchant site.
require '/wordpress/wp-load.php';
// Keep WordPress's admin avatar service out of the plugin network checks.
update_option('show_avatars', 0);
update_option( 'blogname', 'Cedar & Form' );
update_option( 'woocommerce_store_address', '18 Maker Lane' );
update_option( 'woocommerce_store_city', 'Portland' );
update_option( 'woocommerce_store_postcode', '97205' );
update_option( 'woocommerce_default_country', 'US:OR' );
update_option( 'woocommerce_currency', 'USD' );
update_option( 'woocommerce_coming_soon', 'no' );
update_option( 'woocommerce_store_pages_only', 'no' );
update_option( 'woocommerce_onboarding_profile', array( 'completed' => true ) );
wp_set_password( 'fullbleed-local-test', 1 );
foreach ( array( 'editor', 'subscriber', 'shop_manager' ) as $role ) {
    $id = wp_create_user( 'fb-' . $role, 'fullbleed-local-test', 'fb-' . $role . '@example.test' );
    if ( ! is_wp_error( $id ) ) { ( new WP_User( $id ) )->set_role( $role ); }
}
$product = new WC_Product_Simple();
$product->set_name( 'Everyday linen throw / Moss' );
$product->set_regular_price( '80.00' );
$product->set_sku( 'LIN-MOSS' );
$product->save();
$second = new WC_Product_Simple();
$second->set_name( 'Stoneware serving bowl / Chalk' );
$second->set_regular_price( '110.00' );
$second->set_sku( 'BWL-CHALK' );
$second->save();
$orders = array();
for ( $i = 0; $i < 2; $i++ ) {
    $order = wc_create_order();
    $order->set_date_created( '2026-10-02 09:00:00' );
    $order->add_product( $product, 2 );
    $order->add_product( $second, 1 );
    $address = array( 'first_name' => 'Alex', 'last_name' => 'Morgan', 'address_1' => '42 Example Street', 'city' => 'Chicago', 'state' => 'IL', 'postcode' => '60601', 'country' => 'US', 'email' => 'alex@example.test' );
    $order->set_address( $address, 'billing' );
    $order->set_address( $address, 'shipping' );
    $shipping = new WC_Order_Item_Shipping();
    $shipping->set_method_title( 'Standard delivery' );
    $shipping->set_total( '12.00' );
    $order->add_item( $shipping );
    $order->calculate_totals( false );
    $order->set_status( 'processing' );
    $order->save();
    $orders[] = $order->get_id();
}
$refunded = wc_create_order();
$refunded->add_product( $product, 1 );
$refunded->calculate_totals( false );
$refunded->set_status( 'refunded' );
$refunded->save();
$result = array( 'orders' => $orders, 'refunded' => $refunded->get_id(), 'wordpress' => get_bloginfo( 'version' ), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION );
file_put_contents( '/wordpress/fullbleed-fixture.json', json_encode( $result ) );
echo json_encode( $result );
