<?php
// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fullbleed\CommercePro\Uninstall;
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

function remove_activity() {
    global $wpdb;
    wp_clear_scheduled_hook( 'fullbleed_activity_cleanup' );
    wp_clear_scheduled_hook( 'fullbleed_failure_alert_check' );
    delete_option( 'fullbleed_failure_alerts' );
    delete_option( 'fullbleed_failure_alert_delivery' );
    delete_option( 'fullbleed_failure_alert_check' );
    $wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}fullbleed_activity" );
    delete_option( 'fullbleed_activity_schema' );
    delete_option( 'fullbleed_activity_storage_error' );
}

if ( is_multisite() ) {
    $offset = 0;
    do {
        $sites = get_sites( array( 'fields' => 'ids', 'number' => 100, 'offset' => $offset ) );
        foreach ( $sites as $site_id ) { switch_to_blog( $site_id ); remove_activity(); restore_current_blog(); }
        $offset += 100;
    } while ( count( $sites ) === 100 );
} else remove_activity();
