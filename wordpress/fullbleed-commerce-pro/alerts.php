<?php
// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fullbleed\CommercePro\Alerts;
defined( 'ABSPATH' ) || exit;

const OPTION = 'fullbleed_failure_alerts';
const DELIVERY_OPTION = 'fullbleed_failure_alert_delivery';
const CHECK_OPTION = 'fullbleed_failure_alert_check';
const HOOK = 'fullbleed_failure_alert_check';

function enabled() { return 'yes' === get_option( OPTION ); }

function sync_schedule() {
    if ( enabled() ) {
        if ( ! wp_next_scheduled( HOOK ) ) wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', HOOK );
    } elseif ( wp_next_scheduled( HOOK ) ) wp_clear_scheduled_hook( HOOK );
}

function deactivate() {
    wp_clear_scheduled_hook( HOOK );
    delete_option( OPTION );
    delete_option( CHECK_OPTION );
    // Retain the one-day reservation across reactivation to avoid duplicate mail.
}

function save() {
    if ( ! current_user_can( 'manage_options' ) ) wp_die( esc_html__( 'Only a site administrator can change failure alerts.', 'fullbleed-commerce-pro' ), '', array( 'response' => 403 ) );
    check_admin_referer( 'fullbleed_failure_alerts_save' );
    update_option( OPTION, isset( $_POST['failure_alerts'] ) ? 'yes' : 'no', false );
    sync_schedule();
    wp_safe_redirect( admin_url( 'admin.php?page=fullbleed-automation&alerts_saved=1#fullbleed-failure-alerts' ) );
    exit;
}

function summary() {
    global $wpdb;
    $name = \Fullbleed\CommercePro\Activity\table();
    $previous = $wpdb->suppress_errors( true );
    $result = array( 'email' => 0, 'customer' => 0, 'storage_error' => (bool) get_option( \Fullbleed\CommercePro\Activity\ERROR_OPTION ) );
    try {
        $rows = $wpdb->get_results( $wpdb->prepare( "SELECT channel, COUNT(*) AS total FROM $name WHERE state = 'failed' AND updated_at >= %s GROUP BY channel", gmdate( 'Y-m-d H:i:s', time() - \Fullbleed\CommercePro\Activity\RETENTION_DAYS * DAY_IN_SECONDS ) ), ARRAY_A );
        if ( $wpdb->last_error || ! is_array( $rows ) ) $result['storage_error'] = true;
        else foreach ( $rows as $row ) if ( in_array( $row['channel'], array( 'email', 'customer' ), true ) ) $result[ $row['channel'] ] = (int) $row['total'];
    } catch ( \Throwable $error ) { $result['storage_error'] = true; }
    finally { $wpdb->suppress_errors( $previous ); }
    return $result;
}

// Compare the persisted bytes, bypassing possibly stale object-cache values.
// Only the winner may hand mail to WordPress, even with overlapping cron workers.
function replace_delivery( $old, $new ) {
    global $wpdb;
    $ok = 1 === $wpdb->query( $wpdb->prepare( "UPDATE $wpdb->options SET option_value = %s WHERE option_name = %s AND option_value = %s", $new, DELIVERY_OPTION, $old ) );
    if ( $ok ) wp_cache_delete( DELIVERY_OPTION, 'options' );
    return $ok;
}

function reserve( $now ) {
    global $wpdb;
    $previous = $wpdb->suppress_errors( true );
    try {
        $claim = wp_json_encode( array( 'attempted_at' => $now, 'status' => 'pending' ) );
        if ( add_option( DELIVERY_OPTION, $claim, '', false ) ) return $claim;
        $old = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM $wpdb->options WHERE option_name = %s", DELIVERY_OPTION ) );
        if ( $wpdb->last_error || ! is_string( $old ) ) return false;
        $state = json_decode( $old, true );
        // Fail closed if the persisted reservation is corrupt or from the future.
        if ( ! is_array( $state ) || ! isset( $state['attempted_at'] ) || ! is_numeric( $state['attempted_at'] ) || $now - (int) $state['attempted_at'] < DAY_IN_SECONDS ) return false;
        return replace_delivery( $old, $claim ) ? $claim : false;
    } catch ( \Throwable $error ) { return false; }
    finally { $wpdb->suppress_errors( $previous ); }
}

function run() {
    if ( ! enabled() ) return;
    $summary = summary();
    update_option( CHECK_OPTION, time(), false );
    if ( ! $summary['email'] && ! $summary['customer'] && ! $summary['storage_error'] ) return;
    $now = time();
    $claim = reserve( $now );
    if ( false === $claim ) return;
    $status = 'failed';
    try {
        $recipient = get_option( 'admin_email' );
        if ( enabled() && is_string( $recipient ) && is_email( $recipient ) ) {
            $body = __( 'Fullbleed document automation needs attention.', 'fullbleed-commerce-pro' ) . "\n\n";
            /* translators: %d: number of retained failed workflows. */
            $body .= sprintf( __( 'Failed email-attachment workflows: %d', 'fullbleed-commerce-pro' ), $summary['email'] ) . "\n";
            /* translators: %d: number of retained failed workflows. */
            $body .= sprintf( __( 'Failed customer-download workflows: %d', 'fullbleed-commerce-pro' ), $summary['customer'] ) . "\n\n";
            if ( $summary['storage_error'] ) $body .= __( 'Activity storage needs attention. These counts may be incomplete; ask your host to check database storage.', 'fullbleed-commerce-pro' ) . "\n\n";
            $body .= __( 'Review the failed results while signed in to WordPress:', 'fullbleed-commerce-pro' ) . "\n" . admin_url( 'admin.php?page=fullbleed-activity&fb_result=failed' ) . "\n\n";
            $body .= __( 'Check the renderer and test a PDF. After recovery, use WooCommerce to resend an affected order email if needed; customers can retry downloads from My Account. This alert does not resend customer emails.', 'fullbleed-commerce-pro' ) . "\n\n";
            $body .= __( 'Fullbleed checks hourly when WordPress scheduled jobs run and attempts at most one summary every 24 hours while failures remain. Manage alerts in WooCommerce > Fullbleed automation.', 'fullbleed-commerce-pro' );
            $status = wp_mail( $recipient, __( '[Fullbleed] PDF workflows need attention', 'fullbleed-commerce-pro' ), $body, array( 'Content-Type: text/plain; charset=UTF-8' ), array() ) ? 'accepted' : 'failed';
        }
    } catch ( \Throwable $error ) { /* Do not store mailer errors, recipients or credentials. */ }
    // Reserve before sending. A crash or ambiguous mail result keeps the daily
    // cooldown; blind retries could duplicate messages already accepted by SMTP.
    global $wpdb;
    $previous = $wpdb->suppress_errors( true );
    try { replace_delivery( $claim, wp_json_encode( array( 'attempted_at' => $now, 'status' => $status ) ) ); }
    catch ( \Throwable $error ) { /* The pending reservation still prevents repeats. */ }
    finally { $wpdb->suppress_errors( $previous ); }
}

function panel() {
    if ( ! current_user_can( 'manage_options' ) ) return;
    $last = json_decode( (string) get_option( DELIVERY_OPTION, '' ), true );
    $checked = (int) get_option( CHECK_OPTION, 0 );
    $labels = array(
        'accepted' => __( 'WordPress accepted the last alert for sending. Recipient delivery is not confirmed.', 'fullbleed-commerce-pro' ),
        'failed' => __( 'The last alert could not be handed to WordPress mail. Check your site email setup and administrator address.', 'fullbleed-commerce-pro' ),
        'pending' => __( 'The last alert attempt has no confirmed result. Check your mail logs before resending anything.', 'fullbleed-commerce-pro' ),
    );
    ?>
    <hr><section id="fullbleed-failure-alerts"><h2><?php esc_html_e( 'Failure alerts', 'fullbleed-commerce-pro' ); ?></h2>
    <?php if ( isset( $_GET['alerts_saved'] ) ) : ?><div class="notice notice-success"><p><?php esc_html_e( 'Failure alert settings saved.', 'fullbleed-commerce-pro' ); ?></p></div><?php endif; ?>
    <p><?php esc_html_e( 'Get an email when document workflows need attention. The summary contains failure counts and a link to activity, with no order details or PDF attachments.', 'fullbleed-commerce-pro' ); ?></p>
    <p><?php esc_html_e( 'Alerts go to the administration email address in WordPress Settings > General:', 'fullbleed-commerce-pro' ); ?> <strong><?php echo esc_html( get_option( 'admin_email' ) ); ?></strong></p>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
    <input type="hidden" name="action" value="fullbleed_failure_alerts_save"><?php wp_nonce_field( 'fullbleed_failure_alerts_save' ); ?>
    <label><input type="checkbox" name="failure_alerts" value="1" <?php checked( enabled() ); ?>> <?php esc_html_e( 'Email the site administrator about unresolved PDF failures.', 'fullbleed-commerce-pro' ); ?></label>
    <p><?php esc_html_e( 'Checks run hourly while WordPress scheduled jobs are running. At most one email is attempted every 24 hours, including after a failed or interrupted send. Alerts stop when the retained activity has no failures and its storage is healthy. This needs a working site mail service and does not monitor whether WordPress itself is online.', 'fullbleed-commerce-pro' ); ?></p>
    <?php submit_button( __( 'Save failure alerts', 'fullbleed-commerce-pro' ), 'secondary' ); ?></form>
    <?php if ( $checked ) : ?><p><?php esc_html_e( 'Last check (UTC):', 'fullbleed-commerce-pro' ); ?> <?php echo esc_html( gmdate( 'Y-m-d H:i:s', $checked ) ); ?></p><?php else : ?><p><?php esc_html_e( 'No scheduled alert check has run yet.', 'fullbleed-commerce-pro' ); ?></p><?php endif; ?>
    <?php if ( ! empty( $last['attempted_at'] ) && isset( $labels[ $last['status'] ?? '' ] ) ) : ?><p><?php echo esc_html( $labels[ $last['status'] ] . ' ' . gmdate( 'Y-m-d H:i:s', (int) $last['attempted_at'] ) . ' UTC' ); ?></p><?php endif; ?>
    <?php if ( enabled() && ! wp_next_scheduled( HOOK ) ) : ?><div class="notice notice-error"><p><?php esc_html_e( 'The alert check could not be scheduled. Ask your host to check WordPress scheduled jobs.', 'fullbleed-commerce-pro' ); ?></p></div><?php endif; ?>
    </section>
    <?php
}

add_action( 'init', __NAMESPACE__ . '\sync_schedule' );
add_action( HOOK, __NAMESPACE__ . '\run' );
add_action( 'admin_post_fullbleed_failure_alerts_save', __NAMESPACE__ . '\save' );
add_action( 'fullbleed_automation_after_settings', __NAMESPACE__ . '\panel' );
