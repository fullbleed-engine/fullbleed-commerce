<?php
// Real native WordPress HTTP transport, local TLS issuer, and captured mail.
// Only the fixture's private hostname and certificate trust are adjusted.
if ( '1' !== getenv( 'FULLBLEED_NATIVE_FIXTURE' ) ) exit( 1 );
require '/var/www/html/wp-load.php';
use function Fullbleed\CommercePro\Automation\render_document;
use function Fullbleed\CommercePro\Automation\attachments;
use function Fullbleed\CommercePro\Automation\settings;

$checks = array();
function check( $name, $ok ) {
    global $checks;
    if ( ! $ok ) throw new RuntimeException( $name );
    $checks[] = array( 'name' => $name, 'passed' => true );
    file_put_contents( '/tmp/fullbleed-native-checks.json', json_encode( $checks ) );
}
add_filter( 'http_request_host_is_external', function ( $external, $host ) { return 'renderer.example.test' === $host ? true : $external; }, 10, 2 );
$trust = function ( $args, $url ) {
    if ( 0 === strpos( $url, 'https://renderer.example.test/' ) ) $args['sslcertificates'] = '/tmp/fullbleed-root.crt';
    return $args;
};
wp_set_current_user( 1 );
$mode = $argv[1] ?? 'render';
$order_id = (int) get_option( 'fullbleed_native_order' );
if ( ! $order_id ) {
    // This fixture is initialized once, with synthetic product/customer data.
    add_filter( 'pre_wp_mail', '__return_true' );
    update_option( 'blogname', 'Cedar & Form' );
    update_option( 'woocommerce_currency', 'USD' );
    update_option( 'woocommerce_default_country', 'US:OR' );
    $product = new WC_Product_Simple();
    $product->set_name( 'Everyday linen throw / Moss' );
    $product->set_regular_price( '80.00' );
    $product->set_sku( 'LIN-MOSS' );
    $product->save();
    $order = wc_create_order();
    $order->set_date_created( '2026-10-03 09:00:00' );
    $order->add_product( $product, 2 );
    $address = array( 'first_name' => 'Alex', 'last_name' => 'Morgan', 'address_1' => '42 Example Street', 'city' => 'Chicago', 'state' => 'IL', 'postcode' => '60601', 'country' => 'US', 'email' => 'alex@example.test' );
    $order->set_address( $address, 'billing' );
    $order->set_address( $address, 'shipping' );
    $order->calculate_totals( false );
    $order->set_status( 'processing' );
    $order->save();
    $order_id = $order->get_id();
    update_option( 'fullbleed_native_order', $order_id );
    remove_filter( 'pre_wp_mail', '__return_true' );
}
$order = wc_get_order( $order_id );
$config = array( 'url' => 'https://renderer.example.test', 'site' => 'synthetic-store', 'token' => trim( file_get_contents( '/tmp/wordpress-token.txt' ) ), 'consent' => true, 'summary_emails' => array( 'customer_processing_order' ), 'packing_emails' => array(), 'customer_downloads' => false );
update_option( Fullbleed\CommercePro\Automation\OPTION, $config, false );

if ( 'render' === $mode ) {
    check( 'native PHP has a real cURL transport', extension_loaded( 'curl' ) );
    check( 'WooCommerce uses HPOS', Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() );
    $untrusted = render_document( $order, 'order-summary' );
    check( 'WordPress rejects the untrusted local TLS issuer', is_wp_error( $untrusted ) && 'connection_failed' === $untrusted->get_error_code() );
    add_filter( 'http_request_args', $trust, 10, 2 );
    check( 'native PHP can read the explicitly trusted public CA certificate', is_readable( '/tmp/fullbleed-root.crt' ) );
    $observed = array();
    add_action( 'http_api_debug', function ( $response, $context, $transport, $args, $url ) use ( &$observed ) {
        if ( 'https://renderer.example.test/v1/render' === $url ) $observed[] = array( 'tlsVerified' => true === $args['sslverify'], 'redirects' => $args['redirection'], 'code' => wp_remote_retrieve_response_code( $response ), 'transport' => $transport, 'error' => is_wp_error( $response ) ? $response->get_error_message() : '' );
    }, 10, 5 );
    $pdf = render_document( $order, 'order-summary' );
    if ( is_wp_error( $pdf ) ) throw new RuntimeException( 'Fixture HTTPS failure: ' . $pdf->get_error_code() . '; transport=' . wp_json_encode( $observed ) );
    check( 'trusted HTTPS renderer returns a real verified PDF', is_string( $pdf ) && '%PDF-' === substr( $pdf, 0, 5 ) );
    check( 'WordPress verifies TLS and does not follow redirects', 1 === count( $observed ) && $observed[0]['tlsVerified'] && 0 === $observed[0]['redirects'] && 200 === $observed[0]['code'] );
    file_put_contents( '/tmp/fullbleed-native-summary.pdf', $pdf );
    $request = new WP_REST_Request(); $request['id'] = $order_id;
    file_put_contents( '/tmp/fullbleed-native-order.json', wp_json_encode( Fullbleed\Commerce\get_order( $request )->get_data() ) );
    $config['token'] = str_repeat( 'x', 43 ); update_option( Fullbleed\CommercePro\Automation\OPTION, $config, false );
    $denied = render_document( $order, 'order-summary' );
    check( 'real HTTPS service rejects a revoked or incorrect token', is_wp_error( $denied ) && 'renderer_401' === $denied->get_error_code() );
    $config['token'] = trim( file_get_contents( '/tmp/wordpress-token.txt' ) ); update_option( Fullbleed\CommercePro\Automation\OPTION, $config, false );
    $packing = render_document( $order, 'packing-slip' );
    check( 'same HTTPS service generates a packing slip', is_string( $packing ) && '%PDF-' === substr( $packing, 0, 5 ) );
    file_put_contents( '/tmp/fullbleed-native-packing.pdf', $packing );
} else {
    add_filter( 'http_request_args', $trust, 10, 2 );
}

if ( 'revoked' === $mode ) {
    $denied = render_document( $order, 'order-summary' );
    check( 'previous token is rejected after connection rotation', is_wp_error( $denied ) && 'renderer_401' === $denied->get_error_code() );
    echo json_encode( array( 'mode' => $mode, 'checks' => $checks ) );
    exit;
}

// Capture PHPMailer after its real preSend serialization; never send an email.
require_once ABSPATH . WPINC . '/PHPMailer/Exception.php';
require_once ABSPATH . WPINC . '/PHPMailer/PHPMailer.php';
require_once ABSPATH . WPINC . '/PHPMailer/SMTP.php';
class FullbleedNativeCapture extends PHPMailer\PHPMailer\PHPMailer {
    public function postSend() { file_put_contents( '/tmp/fullbleed-native-mail.eml', $this->getSentMIMEMessage() ); return true; }
}
$GLOBALS['phpmailer'] = new FullbleedNativeCapture( true );
$emails = WC()->mailer()->get_emails();
$email = $emails['WC_Email_Customer_Processing_Order'];
$email->enabled = 'yes';
$paths = array();
add_filter( 'woocommerce_email_attachments', function ( $items ) use ( &$paths ) {
    foreach ( $items as $path ) if ( is_string( $path ) && file_exists( $path ) ) $paths[] = $path;
    return $items;
}, 99 );
$email->trigger( $order_id, $order );
$mime = file_get_contents( '/tmp/fullbleed-native-mail.eml' );
check( 'WooCommerce serializes the original transactional email without outbound mail', false !== strpos( $mime, 'alex@example.test' ) );
$fresh_order = wc_get_order( $order_id );
$result = $fresh_order->get_meta( '_fullbleed_attachment_result' );
if ( 'outage' === $mode ) {
    check( 'renderer outage preserves the email without an invalid attachment', empty( $paths ) && false === strpos( $mime, 'application/pdf' ) );
    check( 'renderer outage records a safe merchant-visible failure', 'failed' === $result['state'] && 'renderer_502' === $result['code'] );
} else {
    if ( 1 !== count( $paths ) || false === strpos( $mime, 'application/pdf' ) ) {
        preg_match_all( '/^Content-Type:[^\r\n]*/mi', $mime, $types );
        throw new RuntimeException( 'Fixture attachment mismatch: ' . json_encode( array( 'count' => count( $paths ), 'result' => $result, 'types' => $types[0] ) ) );
    }
    check( 'native WooCommerce email attaches an HTTPS-generated PDF', 1 === count( $paths ) && false !== strpos( $mime, 'application/pdf' ) );
    $attachment = file_get_contents( $paths[0] );
    check( 'attachment bytes match the direct HTTPS PDF', hash_equals( hash_file( 'sha256', '/tmp/fullbleed-native-summary.pdf' ), hash( 'sha256', $attachment ) ) );
    check( 'attachment uses private temporary storage outside the public root', 0 !== strpos( realpath( $paths[0] ), realpath( ABSPATH ) . '/' ) && 0600 === ( fileperms( $paths[0] ) & 0777 ) );
    check( 'successful preparation clears a previous failure', 'prepared' === $result['state'] );
}
file_put_contents( '/tmp/fullbleed-native-attachment-paths.json', json_encode( $paths ) );
echo json_encode( array( 'mode' => $mode, 'wordpress' => get_bloginfo( 'version' ), 'woocommerce' => WC_VERSION, 'php' => PHP_VERSION, 'checks' => $checks ) );
