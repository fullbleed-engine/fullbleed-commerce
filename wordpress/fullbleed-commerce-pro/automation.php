<?php
// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fullbleed\CommercePro\Automation;
defined( 'ABSPATH' ) || exit;

const OPTION = 'fullbleed_automation';
const MAX_PDF = 8388608;

function settings() {
    return wp_parse_args( get_option( OPTION, array() ), array( 'url' => '', 'site' => '', 'token' => '', 'consent' => false, 'summary_emails' => array(), 'packing_emails' => array(), 'customer_downloads' => false ) );
}

function email_choices() {
    return array( 'customer_processing_order' => 'Customer processing order', 'customer_completed_order' => 'Customer completed order', 'customer_invoice' => 'Customer order details', 'new_order' => 'Store new-order notification' );
}

function connected( $config ) {
    return $config['consent'] && $config['url'] && $config['site'] && strlen( $config['token'] ) >= 32;
}

add_action( 'admin_menu', function () {
    add_submenu_page( 'woocommerce', 'Fullbleed automation', 'Fullbleed automation', 'manage_woocommerce', 'fullbleed-automation', __NAMESPACE__ . '\page' );
} );
add_action( 'admin_post_fullbleed_automation_save', __NAMESPACE__ . '\save' );
add_action( 'admin_post_fullbleed_automation_test', __NAMESPACE__ . '\test_connection' );
add_filter( 'woocommerce_email_attachments', __NAMESPACE__ . '\attachments', 20, 4 );
add_filter( 'woocommerce_defer_transactional_emails', function ( $defer ) {
    $config = settings();
    // Let WooCommerce own its transactional queue and retries. Rendering should
    // run in its email worker, not in the customer's checkout request.
    return $defer || ( connected( $config ) && ( $config['summary_emails'] || $config['packing_emails'] ) );
} );
add_action( 'woocommerce_admin_order_data_after_order_details', __NAMESPACE__ . '\order_status' );

function save() {
    if ( ! current_user_can( 'manage_woocommerce' ) ) wp_die( 'You cannot change document automation.', '', array( 'response' => 403 ) );
    check_admin_referer( 'fullbleed_automation_save' );
    $config = settings();
    if ( isset( $_POST['disconnect'] ) ) {
        delete_option( OPTION );
    } else {
        $url = esc_url_raw( trim( wp_unslash( $_POST['renderer_url'] ?? '' ) ) );
        $parts = wp_parse_url( $url );
        if ( ! $parts || 'https' !== ( $parts['scheme'] ?? '' ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || ! in_array( $parts['path'] ?? '', array( '', '/' ), true ) ) wp_die( 'Use the HTTPS origin of your renderer, without a path, query or credentials.' );
        $site = sanitize_text_field( wp_unslash( $_POST['renderer_site'] ?? '' ) );
        if ( ! preg_match( '/^[a-zA-Z0-9_-]{3,80}$/D', $site ) ) wp_die( 'Use the site ID supplied with your renderer connection.' );
        $token = trim( wp_unslash( $_POST['renderer_token'] ?? '' ) );
        if ( '' === $token && ( rtrim( $url, '/' ) !== $config['url'] || $site !== $config['site'] ) ) wp_die( 'Supply a new access token when changing the renderer or site ID.' );
        if ( '' !== $token && ( strlen( $token ) < 32 || strlen( $token ) > 512 || preg_match( '/\s/', $token ) ) ) wp_die( 'Use the complete renderer access token.' );
        $emails = array_keys( email_choices() );
        $consent = isset( $_POST['consent'] );
        $config = array( 'url' => rtrim( $url, '/' ), 'site' => $site, 'token' => '' === $token ? $config['token'] : $token, 'consent' => $consent );
        foreach ( array( 'summary_emails', 'packing_emails' ) as $key ) $config[ $key ] = $consent && is_array( $_POST[ $key ] ?? null ) ? array_values( array_intersect( $emails, array_map( 'sanitize_text_field', wp_unslash( $_POST[ $key ] ) ) ) ) : array();
        $config['customer_downloads'] = $consent && isset( $_POST['customer_downloads'] );
        update_option( OPTION, $config, false );
    }
    wp_safe_redirect( admin_url( 'admin.php?page=fullbleed-automation&saved=1' ) ); exit;
}

function render_document( $order, $kind ) {
    $config = settings();
    if ( ! connected( $config ) ) return new \WP_Error( 'not_connected', 'Connect a renderer and allow order processing first.' );
    if ( ! is_a( $order, '\WC_Order' ) || ! in_array( $kind, array( 'order-summary', 'packing-slip' ), true ) || ! function_exists( '\Fullbleed\Commerce\get_order' ) ) return new \WP_Error( 'invalid_order', 'Choose a supported order and document.' );
    // Internal callers must authorize the order first: platform email, staff
    // permission or verified customer ownership. The public REST route stays staff-only.
    $request = new \WP_REST_Request(); $request['id'] = $order->get_id();
    $data = \Fullbleed\Commerce\get_order( $request );
    if ( is_wp_error( $data ) ) return $data;
    $saved = get_option( 'fullbleed_template_' . $kind, array() );
    $options = array( 'kind' => $kind, 'design' => 'studio' );
    if ( ! empty( $saved['template'] ) ) $options['template'] = $saved['template'];
    $body = wp_json_encode( array( 'order' => $data->get_data(), 'options' => $options ) );
    if ( ! is_string( $body ) || strlen( $body ) > 786432 ) return new \WP_Error( 'request_size', 'The order and template exceed the rendering limit.' );
    $response = wp_safe_remote_post( $config['url'] . '/v1/render', array(
        'timeout' => 20, 'redirection' => 0, 'sslverify' => true, 'limit_response_size' => MAX_PDF + 1,
        'headers' => array( 'Authorization' => 'Bearer ' . $config['token'], 'X-Fullbleed-Site' => $config['site'], 'Content-Type' => 'application/json', 'Accept' => 'application/pdf' ),
        'body' => $body,
    ) );
    // Do not surface remote response bodies: they may contain credentials or PII.
    if ( is_wp_error( $response ) ) return new \WP_Error( 'connection_failed', 'The renderer could not be reached. The order email can still be sent.' );
    $status = wp_remote_retrieve_response_code( $response );
    if ( 200 !== $status ) return new \WP_Error( 'renderer_' . absint( $status ), 'The renderer did not produce a document. Check the connection and template preview.' );
    $pdf = wp_remote_retrieve_body( $response );
    $digest = wp_remote_retrieve_header( $response, 'x-fullbleed-sha256' );
    if ( strlen( $pdf ) > MAX_PDF || '%PDF-' !== substr( $pdf, 0, 5 ) || 0 !== strpos( wp_remote_retrieve_header( $response, 'content-type' ), 'application/pdf' ) || ! preg_match( '/^[a-f0-9]{64}$/D', (string) $digest ) || ! hash_equals( $digest, hash( 'sha256', $pdf ) ) ) return new \WP_Error( 'invalid_pdf', 'The renderer response was incomplete or exceeded 8 MiB.' );
    return $pdf;
}

function private_attachment( $pdf ) {
    // tmpfile is outside uploads and removed when its request-owned handle closes.
    // Fail closed on hosts whose temp directory is inside a public root.
    $handle = tmpfile();
    if ( ! $handle ) return new \WP_Error( 'temp_unavailable', 'A private temporary attachment could not be created.' );
    $path = stream_get_meta_data( $handle )['uri'];
    $resolved = str_replace( '\\', '/', realpath( $path ) ?: $path );
    foreach ( array( ABSPATH, $_SERVER['DOCUMENT_ROOT'] ?? '' ) as $root ) {
        $root = rtrim( str_replace( '\\', '/', realpath( $root ) ?: $root ), '/' );
        if ( $root && 0 === stripos( $resolved, $root . '/' ) ) { fclose( $handle ); return new \WP_Error( 'temp_public', 'Configure PHP with a temporary directory outside the web root.' ); }
    }
    if ( ! chmod( $path, 0600 ) || fwrite( $handle, $pdf ) !== strlen( $pdf ) || ! fflush( $handle ) ) { fclose( $handle ); return new \WP_Error( 'temp_write', 'The attachment could not be written safely.' ); }
    // PHPMailer needs a filename, while this open handle owns the lifetime.
    register_shutdown_function( function () use ( $handle ) { if ( is_resource( $handle ) ) fclose( $handle ); } );
    return $path;
}

function record( $order, $email_id, $state, $code, $kinds = array( 'order-summary' ) ) {
    $order->update_meta_data( '_fullbleed_attachment_result', array( 'state' => $state, 'code' => sanitize_key( $code ), 'email' => sanitize_key( $email_id ), 'time' => gmdate( 'c' ) ) );
    $order->save_meta_data();
    \Fullbleed\CommercePro\Activity\record( $order, 'email', $email_id, count( $kinds ) > 1 ? 'both' : $kinds[0], $state, $code );
}

function attachments( $attachments, $email_id, $order, $email = null ) {
    $config = settings();
    if ( ! connected( $config ) || ! is_a( $order, '\WC_Order' ) ) return $attachments;
    $kinds = array();
    if ( in_array( $email_id, $config['summary_emails'], true ) ) $kinds[] = 'order-summary';
    if ( in_array( $email_id, $config['packing_emails'], true ) ) $kinds[] = 'packing-slip';
    if ( ! $kinds ) return $attachments;
    $created = array();
    foreach ( $kinds as $kind ) {
        $pdf = render_document( $order, $kind );
        $path = is_wp_error( $pdf ) ? $pdf : private_attachment( $pdf );
        if ( is_wp_error( $path ) ) { record( $order, $email_id, 'failed', $path->get_error_code(), $kinds ); return $attachments; }
        // WordPress accepts display name => path attachment maps. This supplies
        // a useful .pdf filename without exposing an order ID in a public path.
        $created[ 'fullbleed-' . $kind . '-' . $order->get_id() . '.pdf' ] = $path;
    }
    record( $order, $email_id, 'prepared', 'attachment_prepared', $kinds );
    return array_merge( $attachments, $created );
}

function test_connection() {
    if ( ! current_user_can( 'manage_woocommerce' ) ) wp_die( 'You cannot test this connection.', '', array( 'response' => 403 ) );
    check_admin_referer( 'fullbleed_automation_test' );
    $id = absint( $_POST['order_id'] ?? 0 );
    if ( ! current_user_can( 'edit_shop_order', $id ) ) wp_die( 'Order access denied.', '', array( 'response' => 403 ) );
    $pdf = render_document( wc_get_order( $id ), 'order-summary' );
    if ( is_wp_error( $pdf ) ) wp_die( esc_html( $pdf->get_error_message() ) );
    nocache_headers(); header( 'Content-Type: application/pdf' ); header( 'X-Content-Type-Options: nosniff' ); header( 'Content-Disposition: attachment; filename="fullbleed-connection-test.pdf"' );
    echo $pdf; exit; // Binary PDF verified by signature, size and SHA-256 above.
}

function order_status( $order ) {
    if ( ! current_user_can( 'edit_shop_order', $order->get_id() ) ) return;
    $result = $order->get_meta( '_fullbleed_attachment_result' );
    if ( ! is_array( $result ) || empty( $result['state'] ) ) return;
    $message = 'failed' === $result['state'] ? 'PDF attachment failed. Check Fullbleed automation, then use WooCommerce to resend the order email.' : 'PDF attachment prepared for WooCommerce. Delivery is handled by your mail service.';
    echo '<p class="form-field form-field-wide"><strong>Fullbleed:</strong> ' . esc_html( $message ) . ' <small>' . esc_html( $result['time'] ?? '' ) . '</small></p>';
}

function page() {
    if ( ! current_user_can( 'manage_woocommerce' ) ) return;
    $config = settings();
    ?>
    <div class="wrap"><h1>Fullbleed automation</h1><p>Attach your branded documents to the transactional emails WooCommerce already sends, and let customers download their order summaries from My Account.</p>
    <p><a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=fullbleed-activity' ) ); ?>">View activity and failures</a></p>
    <p>Automation requires a connected server renderer. It receives the order's document fields and template over HTTPS and returns a PDF. The free browser workflow works independently. Only enable a renderer you operate or trust.</p>
    <?php if ( isset( $_GET['saved'] ) ) : ?><div class="notice notice-success"><p>Automation settings saved.</p></div><?php endif; ?>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <input type="hidden" name="action" value="fullbleed_automation_save"><?php wp_nonce_field( 'fullbleed_automation_save' ); ?>
    <table class="form-table"><tr><th><label for="fb-renderer-url">Renderer URL</label></th><td><input class="regular-text" type="url" id="fb-renderer-url" name="renderer_url" placeholder="https://pdf.example.com" value="<?php echo esc_attr( $config['url'] ); ?>"></td></tr>
    <tr><th><label for="fb-renderer-site">Site ID</label></th><td><input class="regular-text" id="fb-renderer-site" name="renderer_site" value="<?php echo esc_attr( $config['site'] ); ?>"></td></tr>
    <tr><th><label for="fb-renderer-token">Access token</label></th><td><input class="regular-text" type="password" autocomplete="new-password" id="fb-renderer-token" name="renderer_token" value=""><p class="description">Leave blank to keep the existing token. It is never sent to the template editor.</p></td></tr>
    <tr><th>Order processing</th><td><label><input type="checkbox" name="consent" value="1" <?php checked( $config['consent'] ); ?>> Allow order document fields and templates to be sent to this renderer.</label></td></tr>
    <?php foreach ( array( 'summary_emails' => 'Order summary attachments', 'packing_emails' => 'Packing slip attachments' ) as $key => $label ) : ?>
    <tr><th><?php echo esc_html( $label ); ?></th><td><?php foreach ( email_choices() as $value => $name ) : ?><label style="display:block;margin-bottom:8px"><input type="checkbox" name="<?php echo esc_attr( $key ); ?>[]" value="<?php echo esc_attr( $value ); ?>" <?php checked( in_array( $value, $config[ $key ], true ) ); ?>> <?php echo esc_html( $name ); ?></label><?php endforeach; ?></td></tr>
    <?php endforeach; ?>
    <tr><th>Customer downloads</th><td><label><input type="checkbox" name="customer_downloads" value="1" <?php checked( $config['customer_downloads'] ); ?>> Show Order summary PDF in My Account.</label><p class="description">Signed-in buyers can download their own processing or completed orders. Guest orders, cancellations and refunds are excluded. Downloads use the current order details and saved summary template; they are not archived invoices.</p></td></tr></table>
    <p>Start with no email types selected. Save the connection, test a PDF below, then enable the desired attachments. Enabling attachments uses WooCommerce's background transactional-email queue, so your scheduled jobs must be running. A rendering failure leaves the original order email intact and records an error on the order. This feature does not send additional emails or change order status.</p>
    <p>Customer downloads are a separate opt-in. PDFs are generated when requested and are never placed in public uploads. Disabling customer downloads or disconnecting the renderer stops future requests.</p>
    <?php submit_button( 'Save automation settings' ); ?><button class="button" name="disconnect" value="1">Disconnect renderer</button></form>
    <hr><h2>Test with an order</h2><p>Download a PDF through the connected renderer. This test sends no email and changes no order status.</p>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="fullbleed_automation_test"><?php wp_nonce_field( 'fullbleed_automation_test' ); ?><label>Order ID <input type="number" name="order_id" min="1" required></label> <?php submit_button( 'Test PDF connection', 'secondary', 'submit', false ); ?></form>
    <p>Use a private PHP temporary directory outside the web root. Standard WooCommerce mail is supported; third-party mail queues that defer reading attachment files need separate staging verification. Attachment preparation does not confirm delivery.</p>
    <?php do_action( 'fullbleed_automation_after_settings' ); ?>
    </div>
    <?php
}
