<?php
// Included by the disposable automation fixture; real WP database and WC CRUD.
use function Fullbleed\CommercePro\Activity\record as activity_record;
use function Fullbleed\CommercePro\Activity\rows as activity_rows;
use function Fullbleed\CommercePro\Activity\table as activity_table;

global $wpdb;
$activity_table = activity_table();
$activity_rows = activity_rows();
fb_check( 'activity records actual attachment-hook failures', count( $activity_rows ) === 2 && 'failed' === $activity_rows[0]['state'] && 'email' === $activity_rows[0]['channel'] );
fb_check( 'activity cleanup is scheduled once', (bool) wp_next_scheduled( Fullbleed\CommercePro\Activity\CLEANUP_HOOK ) );

$mode = 'ok';
$recovered = apply_filters( 'woocommerce_email_attachments', array(), 'customer_processing_order', wc_get_order( 12 ), null );
fb_check( 'a real recovery replaces stale failure without duplicating the workflow', count( $recovered ) === 1 && count( activity_rows() ) === 2 && 'prepared' === activity_rows()[0]['state'] && 1 === count( activity_rows( true ) ) );
activity_record( wc_get_order( 12 ), 'email', 'customer_completed_order', 'both', 'failed', 'renderer_429' );
fb_check( 'different email workflows retain separate results', count( activity_rows() ) === 3 && 'both' === activity_rows()[0]['documents'] );
activity_record( wc_get_order( 12 ), 'customer', 'my-account', 'order-summary', 'ready', 'pdf_prepared' );
fb_check( 'customer response readiness is distinct from mail preparation', count( activity_rows() ) === 4 && 'ready' === activity_rows()[0]['state'] );
fb_check( 'unknown workflows and unsupported states are rejected', false === activity_record( wc_get_order( 12 ), 'email', 'arbitrary@example.test', 'both', 'failed', 'renderer_429' ) && false === activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'both', 'delivered', 'anything' ) );
activity_record( wc_get_order( 12 ), 'customer', 'my-account', 'order-summary', 'failed', 'private-secret@example.test' );
$stored = wp_json_encode( $wpdb->get_results( "SELECT * FROM $activity_table", ARRAY_A ) );
fb_check( 'activity stores only references and allowlisted error codes', false === strpos( $stored, 'private-secret' ) && false === strpos( $stored, 'Alex' ) && false === strpos( $stored, 'synthetic-renderer-token' ) && false !== strpos( $stored, 'document_unavailable' ) );

wp_set_current_user( 0 ); ob_start(); Fullbleed\CommercePro\Activity\page(); $activity_html = ob_get_clean();
fb_check( 'activity view is unavailable to anonymous visitors', '' === $activity_html );
$customer = wp_create_user( 'activity-buyer', 'fullbleed-local-test', 'activity-buyer@example.test' );
( new WP_User( $customer ) )->set_role( 'customer' );
wp_set_current_user( $customer ); ob_start(); Fullbleed\CommercePro\Activity\page(); $activity_html = ob_get_clean();
fb_check( 'customer role cannot read merchant activity', '' === $activity_html );
wp_set_current_user( 1 );
$_GET['fb_result'] = 'failed'; ob_start(); Fullbleed\CommercePro\Activity\page(); $activity_html = ob_get_clean(); unset( $_GET['fb_result'] );
fb_check( 'failed filter excludes recovered workflow and supplies specific guidance', false === strpos( $activity_html, 'Attachment prepared' ) && false !== strpos( $activity_html, 'renderer_429' ) && false !== strpos( $activity_html, 'availability or capacity' ) );
fb_check( 'activity links use the authorized WooCommerce order edit URL', false !== strpos( html_entity_decode( $activity_html ), wc_get_order( 12 )->get_edit_order_url() ) );
fb_check( 'activity HTML excludes tokens, customer names, addresses and remote bodies', false === strpos( $activity_html, 'synthetic-renderer-token' ) && false === strpos( $activity_html, 'Alex Morgan' ) && false === strpos( $activity_html, 'private-secret' ) );
require_once ABSPATH . 'wp-admin/includes/screen.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-screen.php';
set_current_screen( 'woocommerce_page_wc-orders' );
ob_start(); Fullbleed\CommercePro\Activity\notice(); $notice = ob_get_clean();
fb_check( 'WooCommerce screens surface unresolved PDF failures', false !== strpos( $notice, 'PDF workflows need attention' ) && false !== strpos( $notice, 'fb_result=failed' ) );
set_current_screen( 'dashboard' ); ob_start(); Fullbleed\CommercePro\Activity\notice(); $notice = ob_get_clean();
fb_check( 'failure notice is scoped to WooCommerce screens', '' === $notice );

// Exercise the platform privacy/deletion hooks, not just our cleanup function.
$deleted = wc_create_order();
activity_record( $deleted, 'email', 'new_order', 'packing-slip', 'prepared', 'attachment_prepared' );
$deleted_id = $deleted->get_id(); $deleted->delete( true );
fb_check( 'WooCommerce order deletion removes activity', 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $activity_table WHERE order_id=%d", $deleted_id ) ) );
$trashed = wc_create_order(); $trashed_id = $trashed->get_id();
activity_record( $trashed, 'email', 'new_order', 'packing-slip', 'prepared', 'attachment_prepared' );
$trashed->delete( false );
fb_check( 'WooCommerce order trash also removes activity', 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $activity_table WHERE order_id=%d", $trashed_id ) ) );
$erased = wc_create_order(); $erased_id = $erased->get_id();
activity_record( $erased, 'email', 'new_order', 'packing-slip', 'prepared', 'attachment_prepared' );
WC_Privacy_Erasers::remove_order_personal_data( $erased );
fb_check( 'WooCommerce anonymization removes activity and prevents new records', 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $activity_table WHERE order_id=%d", $erased_id ) ) && false === activity_record( $erased, 'email', 'new_order', 'packing-slip', 'prepared', 'attachment_prepared' ) );

// An upgrade must initialize storage without requiring plugin reactivation.
delete_option( Fullbleed\CommercePro\Activity\VERSION_OPTION );
Fullbleed\CommercePro\Activity\install();
fb_check( 'schema upgrade preserves existing workflow results', '1' === get_option( Fullbleed\CommercePro\Activity\VERSION_OPTION ) && count( activity_rows() ) === 4 );
$wpdb->query( $wpdb->prepare( "UPDATE $activity_table SET updated_at=%s WHERE order_id=14", gmdate( 'Y-m-d H:i:s', time() - 31 * DAY_IN_SECONDS ) ) );
do_action( Fullbleed\CommercePro\Activity\CLEANUP_HOOK );
fb_check( 'scheduled retention removes results older than 30 days', 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $activity_table WHERE order_id=14" ) );
// Synthetic references only, inserted in a batch to verify bounded storage and pagination.
$values = array();
for ( $i = 1; $i <= 1002; $i++ ) $values[] = $wpdb->prepare( "(%d,'email','new_order','order-summary','prepared','attachment_prepared',%s)", 90000 + $i, gmdate( 'Y-m-d H:i:s' ) );
$wpdb->query( "INSERT INTO $activity_table (order_id,channel,context,documents,state,code,updated_at) VALUES " . implode( ',', $values ) );
Fullbleed\CommercePro\Activity\prune();
fb_check( 'activity storage retains at most 1000 latest workflow results', 1000 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $activity_table" ) );
$first = activity_rows(); $second = activity_rows( false, $first[24]['id'] );
fb_check( 'cursor pagination moves to older results without repeating the first page', count( $first ) === 26 && count( $second ) === 26 && (int) $second[0]['id'] < (int) $first[24]['id'] );
$wpdb->query( "DELETE FROM $activity_table WHERE order_id >= 90000" );

// Missing storage must not suppress the real email attachment or expose DB errors.
$wpdb->query( "DROP TABLE $activity_table" );
ob_start(); $storage_outage = apply_filters( 'woocommerce_email_attachments', array(), 'customer_processing_order', wc_get_order( 12 ), null ); $unexpected = ob_get_clean();
fb_check( 'activity storage failure preserves actual PDF preparation without leaking SQL', count( $storage_outage ) === 1 && '' === $unexpected && get_option( Fullbleed\CommercePro\Activity\ERROR_OPTION ) );
ob_start(); Fullbleed\CommercePro\Activity\page(); $activity_html = ob_get_clean();
fb_check( 'missing activity storage shows an honest incomplete-record warning', false !== strpos( $activity_html, 'Some activity could not be recorded' ) && false === strpos( $activity_html, 'No activity yet' ) );
delete_option( Fullbleed\CommercePro\Activity\VERSION_OPTION ); Fullbleed\CommercePro\Activity\install();
activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'order-summary', 'prepared', 'attachment_prepared' );
fb_check( 'successful storage recovery clears the warning and resumes results', ! get_option( Fullbleed\CommercePro\Activity\ERROR_OPTION ) && count( activity_rows() ) === 1 );
set_current_screen( 'woocommerce_page_wc-orders' ); ob_start(); Fullbleed\CommercePro\Activity\notice(); $notice = ob_get_clean();
fb_check( 'successful recovery clears the WooCommerce failure notice', '' === $notice );
require '/tmp/fullbleed-check-alerts.php';

require_once ABSPATH . 'wp-admin/includes/plugin.php';
deactivate_plugins( 'fullbleed-commerce-pro/fullbleed-commerce-pro.php' );
fb_check( 'deactivation disables alerts and stops their scheduled task', ! Fullbleed\CommercePro\Alerts\enabled() && ! wp_next_scheduled( Fullbleed\CommercePro\Alerts\HOOK ) );
fb_check( 'deactivation clears temporary activity and its scheduled task', ! wp_next_scheduled( Fullbleed\CommercePro\Activity\CLEANUP_HOOK ) && array() === activity_rows() );
uninstall_plugin( 'fullbleed-commerce-pro/fullbleed-commerce-pro.php' );
fb_check( 'uninstall removes alert settings, status and reservations', false === get_option( Fullbleed\CommercePro\Alerts\OPTION ) && false === get_option( Fullbleed\CommercePro\Alerts\CHECK_OPTION ) && false === get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION ) );
fb_check( 'WordPress uninstall removes the activity table and schema options', false === get_option( Fullbleed\CommercePro\Activity\VERSION_OPTION ) && is_wp_error( activity_rows() ) );
activate_plugin( 'fullbleed-commerce-pro/fullbleed-commerce-pro.php' );
fb_check( 'reactivation restores cleanup without changing automation settings', wp_next_scheduled( Fullbleed\CommercePro\Activity\CLEANUP_HOOK ) && Fullbleed\CommercePro\Automation\settings()['consent'] );
// Leave realistic synthetic results for the following HTTP/browser inspection.
activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'order-summary', 'prepared', 'attachment_prepared' );
activity_record( wc_get_order( 13 ), 'email', 'customer_completed_order', 'both', 'failed', 'connection_failed' );
activity_record( wc_get_order( 12 ), 'customer', 'my-account', 'order-summary', 'ready', 'pdf_prepared' );
