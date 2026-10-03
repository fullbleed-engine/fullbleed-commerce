<?php
// Only for a new, disposable Playground. Refuse to seed an existing store.
require '/wordpress/wp-load.php';
if ( ! defined( 'FULLBLEED_COMMERCE_DEMO' ) || true !== FULLBLEED_COMMERCE_DEMO || ! class_exists( 'WooCommerce' ) ) {
    throw new RuntimeException( 'This seed requires the Fullbleed Playground demo.' );
}
if ( get_option( 'fullbleed_demo_orders' ) ) {
    return;
}
if ( wc_get_orders( array( 'limit' => 1, 'return' => 'ids' ) ) ) {
    throw new RuntimeException( 'The sample store must not contain existing orders.' );
}

update_option( 'blogname', 'Cedar & Form' );
update_option( 'woocommerce_store_address', '18 Maker Lane' );
update_option( 'woocommerce_store_city', 'Portland' );
update_option( 'woocommerce_store_postcode', '97205' );
update_option( 'woocommerce_default_country', 'US:OR' );
update_option( 'woocommerce_currency', 'USD' );
update_option( 'woocommerce_custom_orders_table_enabled', 'yes' );
update_option( 'woocommerce_coming_soon', 'no' );
update_option( 'woocommerce_store_pages_only', 'no' );
update_option( 'woocommerce_allow_tracking', 'no' );
update_option( 'woocommerce_onboarding_profile', array( 'completed' => true ) );
delete_transient( '_wc_activation_redirect' );

$products = array();
foreach ( array(
    array( 'Everyday linen throw / Moss', 'LIN-MOSS', '80.00' ),
    array( 'Stoneware serving bowl / Chalk', 'BWL-CHALK', '110.00' ),
) as $details ) {
    $product = new WC_Product_Simple();
    $product->set_name( $details[0] );
    $product->set_sku( $details[1] );
    $product->set_regular_price( $details[2] );
    $product->save();
    $products[] = $product;
}

$orders = array();
foreach ( array( 2, 32 ) as $item_count ) {
    $order = wc_create_order();
    $order->set_date_created( '2026-10-02 09:00:00' );
    for ( $i = 0; $i < $item_count; $i++ ) {
        $order->add_product( $products[ $i % 2 ], $i % 2 ? 1 : 2 );
    }
    $address = array( 'first_name' => 'Alex', 'last_name' => 'Morgan', 'address_1' => '42 Example Street', 'city' => 'Chicago', 'state' => 'IL', 'postcode' => '60601', 'country' => 'US', 'email' => 'alex@example.test' );
    $order->set_address( $address, 'billing' );
    $order->set_address( $address, 'shipping' );
    $shipping = new WC_Order_Item_Shipping();
    $shipping->set_method_title( 'Standard delivery' );
    $shipping->set_total( '12.00' );
    $order->add_item( $shipping );
    $order->calculate_totals( false );
    // Unpaid synthetic orders: no payment or fulfillment is recorded.
    $order->set_status( 'pending' );
    $order->save();
    $orders[] = $order->get_id();
}
update_option( 'fullbleed_demo_orders', $orders, false );
echo wp_json_encode( array( 'orders' => $orders, 'wordpress' => get_bloginfo( 'version' ), 'woocommerce' => WC_VERSION ) );
