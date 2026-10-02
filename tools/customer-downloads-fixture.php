<?php
// SPDX-License-Identifier: MIT
// Installed ONLY in the disposable loopback test store, never in a plugin ZIP.
defined( 'ABSPATH' ) || exit;
add_filter( 'pre_wp_mail', function () { return true; } ); // No fixture email leaves the process.
add_filter( 'pre_http_request', function ( $pre, $args, $url ) {
    if ( '127.0.0.1' !== wp_parse_url( home_url(), PHP_URL_HOST ) || 'https://renderer.example.test/v1/render' !== $url ) return new WP_Error( 'fixture_network_blocked', 'Fixture outbound requests are disabled.' );
    update_option( 'fullbleed_fixture_requests', (int) get_option( 'fullbleed_fixture_requests', 0 ) + 1, false );
    file_put_contents( '/tmp/fullbleed-customer-request.json', $args['body'] );
    if ( 0 !== $args['redirection'] || ! $args['sslverify'] || 'Bearer synthetic-renderer-token-not-for-production' !== $args['headers']['Authorization'] ) throw new Exception( 'Unsafe renderer request.' );
    $mode = get_option( 'fullbleed_fixture_mode', 'ok' );
    if ( 'offline' === $mode ) return new WP_Error( 'timeout', 'PRIVATE-REMOTE-DETAILS' );
    $pdf = file_get_contents( '/tmp/fullbleed-customer.pdf' );
    if ( 'reassign' === $mode ) {
        $order = wc_get_order( 12 ); $order->set_customer_id( get_user_by( 'login', 'fb-buyer-two' )->ID ); $order->save();
    }
    if ( 'cancel' === $mode ) { $order = wc_get_order( 12 ); $order->set_status( 'cancelled' ); $order->save(); }
    if ( 'disconnect' === $mode ) delete_option( 'fullbleed_automation' );
    return array( 'response' => array( 'code' => 'remote-error' === $mode ? 500 : 200 ), 'headers' => array( 'content-type' => 'application/pdf', 'x-fullbleed-sha256' => 'corrupt' === $mode ? str_repeat( '0', 64 ) : hash( 'sha256', $pdf ) ), 'body' => 'remote-error' === $mode ? 'PRIVATE-REMOTE-DETAILS' : $pdf );
}, 10, 3 );
