<?php
// Disposable local synthetic fixture only; launched by check-automation.mjs.
require '/wordpress/wp-load.php';
if ( '127.0.0.1' !== wp_parse_url( home_url(), PHP_URL_HOST ) ) throw new Exception( 'Local test only.' );
$checks = array();
function fb_check( $name, $passed ) { global $checks; $checks[] = array( 'name' => $name, 'passed' => (bool) $passed ); if ( ! $passed ) throw new Exception( $name ); }
$order = wc_get_order( 12 );
$old_status = $order->get_status();
delete_option( 'fullbleed_automation' );
$original = array( '/tmp/unrelated-attachment.txt' );
fb_check( 'attachments remain unchanged before opt-in', $original === apply_filters( 'woocommerce_email_attachments', $original, 'customer_processing_order', $order, null ) );
update_option( 'fullbleed_automation', array( 'url' => 'https://renderer.example.test', 'site' => 'synthetic-store', 'token' => 'synthetic-renderer-token-not-for-production', 'consent' => true, 'summary_emails' => array( 'customer_processing_order' ), 'packing_emails' => array() ), false );
$mode = 'ok'; $requests = 0;
add_filter( 'pre_http_request', function ( $pre, $args, $url ) use ( &$mode, &$requests ) {
    if ( 'https://renderer.example.test/v1/render' !== $url ) return new WP_Error( 'test_network_blocked', 'No external requests in this test.' );
    $requests++;
    fb_check( 'renderer request uses server-only credentials and disables redirects', 0 === $args['redirection'] && $args['sslverify'] && 'Bearer synthetic-renderer-token-not-for-production' === $args['headers']['Authorization'] );
    $body = json_decode( $args['body'], true );
    fb_check( 'automation serializes the authorized WooCommerce order', '12' === $body['order']['number'] && 'fullbleed.commerce-order.v1' === $body['order']['schema'] );
    if ( 'offline' === $mode ) return new WP_Error( 'timeout', 'Simulated unavailable renderer' );
    $pdf = file_get_contents( '/tmp/fullbleed-test.pdf' );
    return array( 'response' => array( 'code' => 200 ), 'headers' => array( 'content-type' => 'application/pdf', 'x-fullbleed-sha256' => 'corrupt' === $mode ? str_repeat( '0', 64 ) : hash( 'sha256', $pdf ) ), 'body' => $pdf );
}, 10, 3 );
fb_check( 'unselected emails cause no rendering', array() === apply_filters( 'woocommerce_email_attachments', array(), 'customer_completed_order', $order, null ) && 0 === $requests );
$attachments = apply_filters( 'woocommerce_email_attachments', array(), 'customer_processing_order', $order, null );
fb_check( 'existing transactional email gets one PDF with a useful filename', count( $attachments ) === 1 && isset( $attachments['fullbleed-order-summary-12.pdf'] ) );
$paths = array_values( $attachments );
fb_check( 'attachment is outside the web root', 0 !== strpos( $paths[0], ABSPATH ) );
fb_check( 'attachment matches actual renderer bytes', file_get_contents( $paths[0] ) === file_get_contents( '/tmp/fullbleed-test.pdf' ) );
clearstatcache( true, $paths[0] );
// Windows-backed Playground does not expose Unix mode bits; Linux CI checks them.
if ( FULLBLEED_TEST_UNIX_PERMISSIONS ) fb_check( 'attachment uses private permissions', ( fileperms( $paths[0] ) & 0777 ) === 0600 );
fb_check( 'enabled attachments request WooCommerce background emails', true === apply_filters( 'woocommerce_defer_transactional_emails', false ) );
file_put_contents( '/tmp/fullbleed-attachment-paths.json', json_encode( $paths ) );

// Use the real wp_mail/PHPMailer integration, intercepting only the final send.
require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
require_once ABSPATH . WPINC . '/PHPMailer/SMTP.php';
class FullbleedCaptureMailer extends \PHPMailer\PHPMailer\PHPMailer {
    public function send() { $ready = $this->preSend(); if ( $ready ) file_put_contents( '/tmp/fullbleed-captured.eml', $this->getSentMIMEMessage() ); return $ready; }
}
$GLOBALS['phpmailer'] = new FullbleedCaptureMailer( true );
// Playground suppresses mail before PHPMailer; replace that fixture interception
// with our MIME-only final-send override and fail if another mailer replaces it.
remove_all_filters( 'pre_wp_mail' );
add_action( 'phpmailer_init', function ( $mailer ) { if ( ! $mailer instanceof FullbleedCaptureMailer ) throw new Exception( 'Refuse outbound mail in the fixture.' ); } );
add_filter( 'wp_mail_from', function () { return 'documents@example.test'; }, 999 );
update_option( 'woocommerce_email_from_address', 'documents@example.test' );
add_action( 'wp_mail_failed', function ( $error ) { throw new Exception( 'Captured mail preparation failed: ' . $error->get_error_message() ); } );
fb_check( 'wp_mail accepts the prepared attachment', wp_mail( 'synthetic@example.test', 'Synthetic Fullbleed document test', 'No message leaves this fixture.', array(), $attachments ) );
$mime = file_get_contents( '/tmp/fullbleed-captured.eml' );
fb_check( 'captured MIME names the PDF attachment', false !== strpos( $mime, 'fullbleed-order-summary-12.pdf' ) && false !== strpos( $mime, 'Content-Disposition: attachment' ) );
$before_worker = $requests;
WC_Emails::send_queued_transactional_email( 'woocommerce_order_status_pending_to_processing', array( 12, $order ) );
fb_check( 'WooCommerce queued-email handler renders the attachment', $requests > $before_worker );
fb_check( 'real WooCommerce email MIME contains the branded PDF', false !== strpos( file_get_contents( '/tmp/fullbleed-captured.eml' ), 'fullbleed-order-summary-12.pdf' ) );
$mode = 'offline';
fb_check( 'renderer outage preserves all existing email attachments', $original === apply_filters( 'woocommerce_email_attachments', $original, 'customer_processing_order', $order, null ) );
$order = wc_get_order( 12 );
fb_check( 'renderer outage records a safe recoverable status', 'failed' === $order->get_meta( '_fullbleed_attachment_result' )['state'] );
$mode = 'corrupt';
fb_check( 'truncated or mismatched PDF never reaches an email', $original === apply_filters( 'woocommerce_email_attachments', $original, 'customer_processing_order', $order, null ) );
$requests_before = $requests;
fb_check( 'refunded orders never call the renderer', array() === apply_filters( 'woocommerce_email_attachments', array(), 'customer_processing_order', wc_get_order( 14 ), null ) && $requests_before === $requests );
require_once ABSPATH . 'wp-admin/includes/template.php';
wp_set_current_user( 1 ); ob_start(); \Fullbleed\CommercePro\Automation\page(); $page = ob_get_clean();
fb_check( 'renderer credentials are absent from admin HTML', false === strpos( $page, 'synthetic-renderer-token-not-for-production' ) );
fb_check( 'automation does not alter order state', wc_get_order( 12 )->get_status() === $old_status );
echo wp_json_encode( array( 'wordpress' => get_bloginfo( 'version' ), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION, 'checks' => $checks ) );
