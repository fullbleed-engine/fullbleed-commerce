<?php
// Real disposable WordPress/WooCommerce with an outbound-blocked PHPMailer.
use function Fullbleed\CommercePro\Alerts\run as alert_run;
use function Fullbleed\CommercePro\Alerts\summary as alert_summary;
use function Fullbleed\CommercePro\Alerts\sync_schedule as alert_schedule;
use function Fullbleed\CommercePro\Activity\record as activity_record;

$original_mime = file_get_contents( '/tmp/fullbleed-captured.eml' );
$original_admin = get_option( 'admin_email' );
update_option( 'admin_email', 'alerts-admin@example.test' );
$alert_calls = array();
$mail_mode = 'ok';
$capture_alert = function ( $pre, $args ) use ( &$alert_calls, &$mail_mode ) {
    $alert_calls[] = $args;
    // Model a second worker reaching the mail path after the first reserved it.
    alert_run();
    if ( 'false' === $mail_mode ) return false;
    if ( 'throw' === $mail_mode ) throw new Exception( 'synthetic-mail-secret' );
    return $pre;
};
add_filter( 'pre_wp_mail', $capture_alert, 20, 2 );
$expire_alert = function () {
    update_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION, wp_json_encode( array( 'attempted_at' => time() - DAY_IN_SECONDS - 1, 'status' => 'accepted' ) ), false );
};

alert_run(); alert_schedule();
fb_check( 'failure alerts default off with no scheduled job or outgoing mail', ! Fullbleed\CommercePro\Alerts\enabled() && ! wp_next_scheduled( Fullbleed\CommercePro\Alerts\HOOK ) && ! $alert_calls );
update_option( Fullbleed\CommercePro\Alerts\OPTION, 'yes', false );
alert_schedule(); alert_schedule();
$scheduled = 0;
foreach ( _get_cron_array() as $hooks ) if ( isset( $hooks[ Fullbleed\CommercePro\Alerts\HOOK ] ) ) $scheduled += count( $hooks[ Fullbleed\CommercePro\Alerts\HOOK ] );
fb_check( 'opt-in schedules exactly one recurring hourly alert check', 1 === $scheduled && 'hourly' === wp_get_schedule( Fullbleed\CommercePro\Alerts\HOOK ) );
do_action( Fullbleed\CommercePro\Alerts\HOOK );
fb_check( 'healthy activity sends no alert and records the scheduled check', ! $alert_calls && get_option( Fullbleed\CommercePro\Alerts\CHECK_OPTION ) > 0 );

activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'order-summary', 'failed', 'connection_failed' );
activity_record( wc_get_order( 13 ), 'customer', 'my-account', 'order-summary', 'failed', 'private-secret@example.test' );
do_action( Fullbleed\CommercePro\Alerts\HOOK );
$alert = $alert_calls[0];
$state = json_decode( get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION ), true );
fb_check( 'scheduled failures produce one administrator alert despite an overlapping worker', 1 === count( $alert_calls ) && 'alerts-admin@example.test' === $alert['to'] && 'accepted' === $state['status'] );
fb_check( 'alert summarizes workflows and links to authenticated recovery', false !== strpos( $alert['message'], 'email-attachment workflows: 1' ) && false !== strpos( $alert['message'], 'customer-download workflows: 1' ) && false !== strpos( $alert['message'], 'page=fullbleed-activity&fb_result=failed' ) );
fb_check( 'alert excludes customer details, order IDs, credentials and attachments', ! $alert['attachments'] && false === strpos( $alert['message'], 'Alex' ) && false === strpos( $alert['message'], 'private-secret' ) && false === strpos( $alert['message'], 'synthetic-renderer-token' ) && false === strpos( $alert['message'], '#12' ) && false === strpos( $alert['message'], '42 Example' ) );
$alert_mime = file_get_contents( '/tmp/fullbleed-captured.eml' );
file_put_contents( '/tmp/fullbleed-alert.eml', $alert_mime );
fb_check( 'real PHPMailer prepares only a plain-text administrator alert', false !== strpos( $alert_mime, 'To: alerts-admin@example.test' ) && false !== strpos( $alert_mime, 'Content-Type: text/plain' ) && false === strpos( $alert_mime, 'Content-Disposition: attachment' ) );
wp_cache_flush(); do_action( Fullbleed\CommercePro\Alerts\HOOK );
fb_check( 'a persisted reservation prevents repeat alerts after cache loss', 1 === count( $alert_calls ) );
$expire_alert(); do_action( Fullbleed\CommercePro\Alerts\HOOK );
fb_check( 'an unresolved failure receives a reminder after the daily cooldown', 2 === count( $alert_calls ) );
activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'order-summary', 'prepared', 'attachment_prepared' );
activity_record( wc_get_order( 13 ), 'customer', 'my-account', 'order-summary', 'ready', 'pdf_prepared' );
$expire_alert(); do_action( Fullbleed\CommercePro\Alerts\HOOK );
fb_check( 'successful workflow recovery stops reminders', 2 === count( $alert_calls ) );
activity_record( wc_get_order( 14 ), 'email', 'new_order', 'packing-slip', 'failed', 'connection_failed' );
$wpdb->query( $wpdb->prepare( "UPDATE $activity_table SET updated_at=%s WHERE order_id=14", gmdate( 'Y-m-d H:i:s', time() - 31 * DAY_IN_SECONDS ) ) );
do_action( Fullbleed\CommercePro\Alerts\HOOK );
fb_check( 'expired activity is excluded even before physical cleanup', 2 === count( $alert_calls ) && 0 === alert_summary()['email'] );

$wpdb->query( "DROP TABLE $activity_table" );
ob_start(); do_action( Fullbleed\CommercePro\Alerts\HOOK ); $sql_output = ob_get_clean();
fb_check( 'missing activity storage sends an incomplete-data alert without leaking SQL', 3 === count( $alert_calls ) && false !== strpos( $alert_calls[2]['message'], 'counts may be incomplete' ) && '' === $sql_output );
delete_option( Fullbleed\CommercePro\Activity\VERSION_OPTION ); Fullbleed\CommercePro\Activity\install();
activity_record( wc_get_order( 12 ), 'email', 'customer_processing_order', 'order-summary', 'failed', 'renderer_503' );
$mail_mode = 'false'; $expire_alert(); do_action( Fullbleed\CommercePro\Alerts\HOOK ); do_action( Fullbleed\CommercePro\Alerts\HOOK );
$state = json_decode( get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION ), true );
fb_check( 'a rejected mail handoff is visible and does not trigger a retry storm', 4 === count( $alert_calls ) && 'failed' === $state['status'] );
ob_start(); Fullbleed\CommercePro\Alerts\panel(); $failed_panel = ob_get_clean();
fb_check( 'administrator sees a rejected mail handoff without a delivery claim', false !== strpos( $failed_panel, 'could not be handed' ) );
$mail_mode = 'throw'; $expire_alert(); do_action( Fullbleed\CommercePro\Alerts\HOOK );
$state = get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION );
fb_check( 'mailer exceptions are contained without persisting raw error details', 5 === count( $alert_calls ) && 'failed' === json_decode( $state, true )['status'] && false === strpos( $state, 'synthetic-mail-secret' ) );
$mail_mode = 'ok'; $expire_alert();
$reservation = Fullbleed\CommercePro\Alerts\reserve( time() );
wp_cache_flush(); alert_run();
fb_check( 'an interrupted send remains reserved across later checks', is_string( $reservation ) && 5 === count( $alert_calls ) && 'pending' === json_decode( get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION ), true )['status'] );
fb_check( 'a stale worker cannot replace a newer reservation', false === Fullbleed\CommercePro\Alerts\replace_delivery( 'obsolete-reservation', '{}' ) );
update_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION, 'malformed-state', false ); alert_run();
fb_check( 'corrupt reservation fails closed without duplicate mail', 5 === count( $alert_calls ) );
$invalid_admin = function () { return 'invalid-admin-address'; };
$expire_alert(); add_filter( 'pre_option_admin_email', $invalid_admin ); alert_run(); remove_filter( 'pre_option_admin_email', $invalid_admin );
fb_check( 'invalid administrator address never reaches the mailer', 5 === count( $alert_calls ) && 'failed' === json_decode( get_option( Fullbleed\CommercePro\Alerts\DELIVERY_OPTION ), true )['status'] );
update_option( 'admin_email', 'alerts-admin@example.test' );
update_option( Fullbleed\CommercePro\Alerts\OPTION, 'no', false ); alert_schedule(); $expire_alert(); alert_run();
fb_check( 'disabling alerts removes the recurring job and blocks later queued calls', ! wp_next_scheduled( Fullbleed\CommercePro\Alerts\HOOK ) && 5 === count( $alert_calls ) );

wp_set_current_user( get_user_by( 'login', 'fb-shop_manager' )->ID );
ob_start(); Fullbleed\CommercePro\Alerts\panel(); $panel = ob_get_clean();
fb_check( 'shop managers cannot view administrator alert controls or destination', '' === $panel );
wp_set_current_user( 1 ); ob_start(); Fullbleed\CommercePro\Alerts\panel(); $panel = ob_get_clean();
fb_check( 'administrator sees mail status and scheduling limitations', false !== strpos( $panel, 'Recipient delivery is not confirmed' ) && false !== strpos( $panel, 'WordPress scheduled jobs' ) && false !== strpos( $panel, 'alerts-admin@example.test' ) );
remove_filter( 'pre_wp_mail', $capture_alert, 20 );
update_option( 'admin_email', $original_admin );
file_put_contents( '/tmp/fullbleed-captured.eml', $original_mime );
// The surrounding fixture verifies deactivation and uninstall of this live job.
update_option( Fullbleed\CommercePro\Alerts\OPTION, 'yes', false ); alert_schedule();
