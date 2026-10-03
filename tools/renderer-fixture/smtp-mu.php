<?php
// Disposable native-container fixture only. Never included in a plugin ZIP.
if ( '1' !== getenv( 'FULLBLEED_NATIVE_FIXTURE' ) ) exit( 1 );

// Exercise host-driven cron deterministically. The real Action Scheduler runner
// and WordPress scheduler still execute in a later, separate PHP process.
add_filter( 'action_scheduler_allow_async_request_runner', '__return_false' );
add_filter( 'http_request_host_is_external', function ( $external, $host ) { return 'renderer.example.test' === $host ? true : $external; }, 10, 2 );
add_filter( 'http_request_args', function ( $args, $url ) {
    if ( 0 === strpos( $url, 'https://renderer.example.test/' ) ) $args['sslcertificates'] = '/tmp/fullbleed-root.crt';
    return $args;
}, 10, 2 );

// No relay or public SMTP port exists. PHPMailer performs its real SMTP send;
// this hook is equivalent to a site's configured SMTP transport plugin.
add_action( 'phpmailer_init', function ( $mailer ) {
    $mailer->isSMTP();
    $mailer->Host = 'mailpit';
    $mailer->Port = 1025;
    $mailer->SMTPAuth = false;
    $mailer->SMTPAutoTLS = false;
    $mailer->SMTPSecure = '';
    $mailer->Timeout = 5;
    $mailer->setFrom( 'documents@example.test', 'Cedar & Form' );
} );
foreach ( array( 'new_order', 'cancelled_order', 'failed_order', 'customer_on_hold_order', 'customer_invoice', 'customer_new_account' ) as $email ) {
    add_filter( 'woocommerce_email_enabled_' . $email, '__return_false' );
}

add_action( 'wp_mail_succeeded', function ( $data ) {
    $attachments = array();
    foreach ( $data['attachments'] as $filename => $path ) {
        $attachments[] = array( 'filename' => $filename, 'path' => $path, 'sha256' => hash_file( 'sha256', $path ), 'permissions' => fileperms( $path ) & 0777, 'outsideWebRoot' => 0 !== strpos( realpath( $path ), realpath( ABSPATH ) . '/' ) );
    }
    file_put_contents( '/tmp/fullbleed-smtp-sent.jsonl', wp_json_encode( array( 'pid' => getmypid(), 'cron' => defined( 'DOING_CRON' ) && DOING_CRON, 'attachments' => $attachments ) ) . "\n", FILE_APPEND | LOCK_EX );
} );
