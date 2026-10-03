<?php
// Synthetic fixture orchestration. Delivery is performed by wp-cron.php or an
// explicit WooCommerce resend, never by manually calling Fullbleed's hooks.
if ( '1' !== getenv( 'FULLBLEED_NATIVE_FIXTURE' ) ) exit( 1 );
require '/var/www/html/wp-load.php';

$mode = $argv[1] ?? '';
if ( 'configure' === $mode ) {
    // Remove only the earlier synthetic phase's unprocessed transactional jobs.
    foreach ( as_get_scheduled_actions( array( 'hook' => 'woocommerce_send_queued_transactional_email', 'status' => 'pending', 'per_page' => 100 ), 'ids' ) as $id ) ActionScheduler::store()->cancel_action( $id );
    $config = Fullbleed\CommercePro\Automation\settings();
    $config['summary_emails'] = array( 'customer_processing_order', 'customer_completed_order' );
    update_option( Fullbleed\CommercePro\Automation\OPTION, $config, false );
    update_option( 'fullbleed_template_order-summary', array( 'template' => json_decode( file_get_contents( '/tmp/fullbleed-smtp-template.json' ), true ), 'revision' => 'smtp-fixture-v1' ), false );
    update_option( Fullbleed\CommercePro\Alerts\OPTION, 'yes', false );
    update_option( 'admin_email', 'admin@example.test' );
    Fullbleed\CommercePro\Alerts\sync_schedule();
    $order = wc_create_order();
    $order->set_date_created( '2026-10-03 10:00:00' );
    $address = array( 'first_name' => 'Alex', 'last_name' => 'Morgan', 'address_1' => '42 Example Street', 'city' => 'Chicago', 'state' => 'IL', 'postcode' => '60601', 'country' => 'US', 'email' => 'alex@example.test' );
    $order->set_address( $address, 'billing' );
    $order->set_address( $address, 'shipping' );
    for ( $index = 1; $index <= 36; $index++ ) {
        $item = new WC_Order_Item_Product();
        $item->set_name( sprintf( 'Studio collection %02d / woven cotton / natural finish', $index ) );
        $item->set_quantity( 2 );
        $item->set_subtotal( '40.00' );
        $item->set_total( '40.00' );
        $order->add_item( $item );
    }
    $order->calculate_totals( false );
    $order->save();
    update_option( 'fullbleed_smtp_order', $order->get_id() );
} elseif ( 'processing' === $mode || 'completed' === $mode ) {
    $order = wc_get_order( (int) get_option( 'fullbleed_smtp_order' ) );
    $order->update_status( $mode, 'Synthetic SMTP workflow check.' );
} elseif ( 'due-queue' === $mode ) {
    // Bring the scheduler's normal hook due without waiting a minute in CI.
    $result = wp_schedule_single_event( time() - 1, 'action_scheduler_run_queue', array( 'Fullbleed SMTP fixture' ), true );
    if ( is_wp_error( $result ) ) throw new RuntimeException( $result->get_error_message() );
} elseif ( 'due-alert' === $mode ) {
    // Preserve the real hourly recurrence; only its first due time is advanced.
    wp_clear_scheduled_hook( Fullbleed\CommercePro\Alerts\HOOK );
    $result = wp_schedule_event( time() - 1, 'hourly', Fullbleed\CommercePro\Alerts\HOOK, array(), true );
    if ( is_wp_error( $result ) ) throw new RuntimeException( $result->get_error_message() );
} elseif ( 'resend' === $mode ) {
    // The recovery contract requires an explicit merchant resend after recovery.
    $order = wc_get_order( (int) get_option( 'fullbleed_smtp_order' ) );
    WC()->mailer()->get_emails()['WC_Email_Customer_Completed_Order']->trigger( $order->get_id(), $order );
} elseif ( 'state' !== $mode ) {
    throw new RuntimeException( 'Unknown synthetic SMTP mode.' );
}

$order_id = (int) get_option( 'fullbleed_smtp_order' );
$request = new WP_REST_Request();
$request['id'] = $order_id;
$order = wc_get_order( $order_id );
$pending = as_get_scheduled_actions( array( 'hook' => 'woocommerce_send_queued_transactional_email', 'status' => 'pending', 'per_page' => 100 ), 'ids' );
$sent = array();
if ( is_file( '/tmp/fullbleed-smtp-sent.jsonl' ) ) {
    foreach ( file( '/tmp/fullbleed-smtp-sent.jsonl', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) as $line ) $sent[] = json_decode( $line, true );
}
echo wp_json_encode( array(
    'mode' => $mode, 'pid' => getmypid(), 'order' => Fullbleed\Commerce\get_order( $request )->get_data(),
    'pending' => array_map( 'intval', $pending ), 'sent' => $sent,
    'activity' => Fullbleed\CommercePro\Activity\rows(), 'failed' => Fullbleed\CommercePro\Activity\rows( true ),
    'attachmentResult' => $order->get_meta( '_fullbleed_attachment_result' ),
    'alert' => json_decode( (string) get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION, '' ), true ),
    'alertCheck' => (int) get_option( Fullbleed\CommercePro\Alerts\CHECK_OPTION, 0 ),
    'alertScheduled' => (bool) wp_next_scheduled( Fullbleed\CommercePro\Alerts\HOOK ),
) );
