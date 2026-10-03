<?php
// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fullbleed\CommercePro\Activity;
defined( 'ABSPATH' ) || exit;

const SCHEMA = '1';
const VERSION_OPTION = 'fullbleed_activity_schema';
const ERROR_OPTION = 'fullbleed_activity_storage_error';
const CLEANUP_HOOK = 'fullbleed_activity_cleanup';
const MAX_RESULTS = 1000;
const RETENTION_DAYS = 30;

function table() {
    global $wpdb;
    return $wpdb->prefix . 'fullbleed_activity';
}

function install() {
    global $wpdb;
    if ( SCHEMA !== get_option( VERSION_OPTION ) ) {
        $previous = $wpdb->suppress_errors( true );
        try {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            $name = table();
            $collation = $wpdb->get_charset_collate();
            dbDelta( "CREATE TABLE $name (
                id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                order_id bigint(20) unsigned NOT NULL,
                channel varchar(16) NOT NULL,
                context varchar(64) NOT NULL,
                documents varchar(32) NOT NULL,
                state varchar(16) NOT NULL,
                code varchar(48) NOT NULL,
                updated_at datetime NOT NULL,
                PRIMARY KEY  (id),
                UNIQUE KEY order_workflow (order_id,channel,context),
                KEY updated_at (updated_at)
            ) $collation;" );
            $wpdb->get_var( "SELECT id FROM $name LIMIT 1" );
            if ( $wpdb->last_error ) {
                update_option( ERROR_OPTION, true, false );
                return;
            }
            update_option( VERSION_OPTION, SCHEMA, false );
        } catch ( \Throwable $error ) {
            update_option( ERROR_OPTION, true, false );
            return;
        } finally {
            $wpdb->suppress_errors( $previous );
        }
    }
    if ( ! wp_next_scheduled( CLEANUP_HOOK ) ) wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', CLEANUP_HOOK );
}

function deactivate( $network_wide = false ) {
    if ( $network_wide && is_multisite() ) {
        $offset = 0;
        do {
            $sites = get_sites( array( 'fields' => 'ids', 'number' => 100, 'offset' => $offset ) );
            foreach ( $sites as $site_id ) { switch_to_blog( $site_id ); deactivate(); restore_current_blog(); }
            $offset += 100;
        } while ( count( $sites ) === 100 );
        return;
    }
    wp_clear_scheduled_hook( CLEANUP_HOOK );
    // Deactivation stops retention jobs, so remove the short-lived results now.
    global $wpdb;
    $previous = $wpdb->suppress_errors( true );
    try { $wpdb->query( 'DELETE FROM ' . table() ); } catch ( \Throwable $error ) { /* Preserve deactivation. */ }
    finally { $wpdb->suppress_errors( $previous ); }
    delete_option( ERROR_OPTION );
}

function prune() {
    global $wpdb;
    $name = table();
    $previous = $wpdb->suppress_errors( true );
    try {
        $ok = false !== $wpdb->query( $wpdb->prepare( "DELETE FROM $name WHERE updated_at < %s", gmdate( 'Y-m-d H:i:s', time() - RETENTION_DAYS * DAY_IN_SECONDS ) ) );
        // The primary key also gives a deterministic order for equal timestamps.
        $cutoff = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $name ORDER BY id DESC LIMIT 1 OFFSET %d", MAX_RESULTS - 1 ) );
        $ok = $ok && ! $wpdb->last_error;
        if ( $cutoff ) $ok = false !== $wpdb->query( $wpdb->prepare( "DELETE FROM $name WHERE id < %d", $cutoff ) ) && $ok;
        if ( ! $ok ) update_option( ERROR_OPTION, true, false );
        return $ok;
    } catch ( \Throwable $error ) {
        update_option( ERROR_OPTION, true, false );
        return false;
    } finally { $wpdb->suppress_errors( $previous ); }
}

function safe_code( $code ) {
    $known = array( 'attachment_prepared', 'pdf_prepared', 'not_connected', 'invalid_order', 'request_size', 'connection_failed', 'invalid_pdf', 'temp_unavailable', 'temp_public', 'temp_write', 'fullbleed_refund_unsupported', 'fullbleed_order_missing' );
    if ( in_array( $code, $known, true ) || ( is_string( $code ) && preg_match( '/^renderer_[1-5][0-9]{2}$/D', $code ) ) ) return $code;
    // A WP_Error supplied by another extension may contain arbitrary private text.
    return 'document_unavailable';
}

function record( $order, $channel, $context, $documents, $state, $code ) {
    if ( ! is_a( $order, '\WC_Order' ) || $order->get_meta( '_anonymized' ) === 'yes' ) return false;
    if ( ! in_array( $documents, array( 'order-summary', 'packing-slip', 'both' ), true ) ) return false;
    if ( ! in_array( $state, array( 'prepared', 'ready', 'failed' ), true ) ) return false;
    if ( 'email' === $channel ) {
        if ( ! array_key_exists( $context, \Fullbleed\CommercePro\Automation\email_choices() ) || 'ready' === $state ) return false;
    } elseif ( 'customer' !== $channel || 'my-account' !== $context || 'prepared' === $state ) return false;
    global $wpdb;
    $previous = $wpdb->suppress_errors( true );
    try {
        // One atomic row replacement per order/workflow: later successful
        // attempts remove a stale failure. This is a status view, not a ledger.
        $ok = false !== $wpdb->replace( table(), array(
            'order_id' => $order->get_id(), 'channel' => $channel, 'context' => $context,
            'documents' => $documents, 'state' => $state, 'code' => safe_code( $code ),
            'updated_at' => gmdate( 'Y-m-d H:i:s' ),
        ), array( '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s' ) );
        if ( $ok && prune() ) delete_option( ERROR_OPTION );
        else update_option( ERROR_OPTION, true, false );
        return $ok;
    } catch ( \Throwable $error ) {
        update_option( ERROR_OPTION, true, false );
        return false;
    } finally { $wpdb->suppress_errors( $previous ); }
}

function erase_order( $order_id ) {
    global $wpdb;
    $id = is_a( $order_id, '\WC_Order' ) ? $order_id->get_id() : absint( $order_id );
    if ( ! $id ) return;
    $previous = $wpdb->suppress_errors( true );
    try {
        if ( false === $wpdb->delete( table(), array( 'order_id' => $id ), array( '%d' ) ) ) update_option( ERROR_OPTION, true, false );
    } catch ( \Throwable $error ) { update_option( ERROR_OPTION, true, false ); }
    finally { $wpdb->suppress_errors( $previous ); }
}

function rows( $failures_only = false, $before = 0 ) {
    global $wpdb;
    $name = table();
    $previous = $wpdb->suppress_errors( true );
    try {
        $sql = $wpdb->prepare( "SELECT * FROM $name WHERE updated_at >= %s", gmdate( 'Y-m-d H:i:s', time() - RETENTION_DAYS * DAY_IN_SECONDS ) );
        if ( $failures_only ) $sql .= " AND state = 'failed'";
        if ( $before > 0 ) $sql .= $wpdb->prepare( ' AND id < %d', $before );
        $result = $wpdb->get_results( $sql . ' ORDER BY id DESC LIMIT 26', ARRAY_A );
        if ( $wpdb->last_error || ! is_array( $result ) ) return new \WP_Error( 'activity_unavailable' );
        return $result;
    } catch ( \Throwable $error ) { return new \WP_Error( 'activity_unavailable' ); }
    finally { $wpdb->suppress_errors( $previous ); }
}

function guidance( $row ) {
    if ( 'prepared' === $row['state'] ) return __( 'Handed to WooCommerce for attachment. Check your mail service for delivery.', 'fullbleed-commerce-pro' );
    if ( 'ready' === $row['state'] ) return __( 'PDF response prepared for the customer. Browser receipt is not tracked.', 'fullbleed-commerce-pro' );
    $code = $row['code'];
    if ( in_array( $code, array( 'not_connected', 'renderer_401', 'renderer_403' ), true ) ) return __( 'Check the renderer connection and access token, then test a PDF.', 'fullbleed-commerce-pro' );
    if ( in_array( $code, array( 'connection_failed', 'renderer_429', 'renderer_502', 'renderer_503', 'renderer_504' ), true ) ) return __( 'Check renderer availability or capacity, then test a PDF before retrying.', 'fullbleed-commerce-pro' );
    if ( 0 === strpos( $code, 'temp_' ) ) return __( 'Ask your host to check private PHP temporary storage outside the web root.', 'fullbleed-commerce-pro' );
    if ( 'invalid_pdf' === $code ) return __( 'Check the renderer response and document size, then test the connection again.', 'fullbleed-commerce-pro' );
    return __( 'Check order eligibility and the saved template in the document preview.', 'fullbleed-commerce-pro' );
}

function notice() {
    if ( ! current_user_can( 'manage_woocommerce' ) || ! function_exists( 'get_current_screen' ) ) return;
    $screen = get_current_screen();
    if ( ! $screen || 'woocommerce_page_fullbleed-activity' === $screen->id || ( 0 !== strpos( $screen->id, 'woocommerce' ) && ! in_array( $screen->id, array( 'shop_order', 'edit-shop_order' ), true ) ) ) return;
    $failed = rows( true );
    if ( is_wp_error( $failed ) || get_option( ERROR_OPTION ) ) $message = __( 'Fullbleed activity may be incomplete. Check database storage before relying on these results.', 'fullbleed-commerce-pro' );
    elseif ( $failed ) $message = __( 'One or more PDF workflows need attention.', 'fullbleed-commerce-pro' );
    else return;
    echo '<div class="notice notice-warning"><p>' . esc_html( $message ) . ' <a href="' . esc_url( admin_url( 'admin.php?page=fullbleed-activity&fb_result=failed' ) ) . '">' . esc_html__( 'Review Fullbleed activity', 'fullbleed-commerce-pro' ) . '</a></p></div>';
}

function page() {
    if ( ! current_user_can( 'manage_woocommerce' ) ) return;
    $failed = isset( $_GET['fb_result'] ) && 'failed' === $_GET['fb_result'];
    $before = isset( $_GET['fb_before'] ) && is_scalar( $_GET['fb_before'] ) ? absint( $_GET['fb_before'] ) : 0;
    prune();
    $results = rows( $failed, $before );
    $base = admin_url( 'admin.php?page=fullbleed-activity' );
    ?>
    <div class="wrap"><h1><?php esc_html_e( 'Fullbleed activity', 'fullbleed-commerce-pro' ); ?></h1>
    <p><?php esc_html_e( 'See the latest PDF result for each order email and customer download workflow. A successful retry replaces the previous failure.', 'fullbleed-commerce-pro' ); ?></p>
    <p><a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=fullbleed-automation' ) ); ?>"><?php esc_html_e( 'Connection and automation settings', 'fullbleed-commerce-pro' ); ?></a></p>
    <?php if ( is_wp_error( $results ) || get_option( ERROR_OPTION ) ) : ?>
        <div class="notice notice-error"><p><?php esc_html_e( 'Some activity could not be recorded. Ask your site administrator to check database storage. This list may be incomplete; order emails and PDF generation continue independently.', 'fullbleed-commerce-pro' ); ?></p></div>
    <?php endif; ?>
    <nav aria-label="<?php esc_attr_e( 'PDF activity results', 'fullbleed-commerce-pro' ); ?>"><ul class="subsubsub">
        <li><a href="<?php echo esc_url( $base ); ?>" <?php if ( ! $failed ) echo 'aria-current="page" class="current"'; ?>><?php esc_html_e( 'All results', 'fullbleed-commerce-pro' ); ?></a> | </li>
        <li><a href="<?php echo esc_url( add_query_arg( 'fb_result', 'failed', $base ) ); ?>" <?php if ( $failed ) echo 'aria-current="page" class="current"'; ?>><?php esc_html_e( 'Failed', 'fullbleed-commerce-pro' ); ?></a></li>
    </ul></nav>
    <div class="fullbleed-activity-table" style="clear:both;overflow-x:auto"><table class="widefat striped" role="table"><caption class="screen-reader-text"><?php esc_html_e( 'Recent automated PDF results', 'fullbleed-commerce-pro' ); ?></caption>
    <thead role="rowgroup"><tr role="row"><?php foreach ( array( __( 'Order', 'fullbleed-commerce-pro' ), __( 'Workflow', 'fullbleed-commerce-pro' ), __( 'Result', 'fullbleed-commerce-pro' ), __( 'Next step', 'fullbleed-commerce-pro' ), __( 'Time (UTC)', 'fullbleed-commerce-pro' ) ) as $heading ) echo '<th scope="col" role="columnheader">' . esc_html( $heading ) . '</th>'; ?></tr></thead><tbody role="rowgroup">
    <?php $visible = is_wp_error( $results ) ? array() : array_slice( $results, 0, 25 ); ?>
    <?php foreach ( $visible as $row ) :
        $order = function_exists( 'wc_get_order' ) ? wc_get_order( $row['order_id'] ) : false;
        $can_open = $order && current_user_can( 'edit_shop_order', $order->get_id() );
        $choices = \Fullbleed\CommercePro\Automation\email_choices();
        $workflow = 'email' === $row['channel'] ? ( $choices[ $row['context'] ] ?? __( 'Order email', 'fullbleed-commerce-pro' ) ) : __( 'Customer My Account', 'fullbleed-commerce-pro' );
        $documents = array( 'order-summary' => __( 'Order summary', 'fullbleed-commerce-pro' ), 'packing-slip' => __( 'Packing slip', 'fullbleed-commerce-pro' ), 'both' => __( 'Summary and packing slip', 'fullbleed-commerce-pro' ) );
        $labels = array( 'prepared' => __( 'Attachment prepared', 'fullbleed-commerce-pro' ), 'ready' => __( 'PDF response ready', 'fullbleed-commerce-pro' ), 'failed' => __( 'Failed', 'fullbleed-commerce-pro' ) );
        ?>
        <tr role="row"><th scope="row" role="rowheader" data-label="<?php esc_attr_e( 'Order', 'fullbleed-commerce-pro' ); ?>"><?php if ( $can_open ) : ?><a href="<?php echo esc_url( $order->get_edit_order_url() ); ?>"><?php echo esc_html( '#' . $row['order_id'] ); ?></a><?php else : ?><?php esc_html_e( 'Order unavailable', 'fullbleed-commerce-pro' ); ?><?php endif; ?></th>
        <td role="cell" data-label="<?php esc_attr_e( 'Workflow', 'fullbleed-commerce-pro' ); ?>"><?php echo esc_html( $workflow ); ?><br><small><?php echo esc_html( $documents[ $row['documents'] ] ?? '' ); ?></small></td>
        <td role="cell" data-label="<?php esc_attr_e( 'Result', 'fullbleed-commerce-pro' ); ?>"><strong><?php echo esc_html( $labels[ $row['state'] ] ?? '' ); ?></strong><?php if ( 'failed' === $row['state'] ) : ?><br><code><?php echo esc_html( safe_code( $row['code'] ) ); ?></code><?php endif; ?></td>
        <td role="cell" data-label="<?php esc_attr_e( 'Next step', 'fullbleed-commerce-pro' ); ?>"><?php echo esc_html( guidance( $row ) ); ?><?php if ( 'failed' === $row['state'] ) : ?><br><small><?php echo esc_html( 'email' === $row['channel'] ? __( 'After recovery, open the order and use WooCommerce to resend the email if needed.', 'fullbleed-commerce-pro' ) : __( 'After recovery, the customer can retry from My Account.', 'fullbleed-commerce-pro' ) ); ?></small><?php endif; ?></td>
        <td role="cell" data-label="<?php esc_attr_e( 'Time (UTC)', 'fullbleed-commerce-pro' ); ?>"><time><?php echo esc_html( $row['updated_at'] ); ?></time></td></tr>
    <?php endforeach; ?>
    <?php if ( ! $visible && ! is_wp_error( $results ) ) : ?><tr><td colspan="5"><?php echo esc_html( $failed ? __( 'No failed results in the retained activity.', 'fullbleed-commerce-pro' ) : __( 'No activity yet. Results appear when an enabled email attachment or customer download is attempted.', 'fullbleed-commerce-pro' ) ); ?></td></tr><?php endif; ?>
    </tbody></table></div>
    <?php if ( ! is_wp_error( $results ) && count( $results ) > 25 ) : ?><p><a class="button" href="<?php echo esc_url( add_query_arg( array( 'fb_result' => $failed ? 'failed' : 'all', 'fb_before' => $visible[24]['id'] ), $base ) ); ?>"><?php esc_html_e( 'Older results', 'fullbleed-commerce-pro' ); ?></a></p><?php endif; ?>
    <p><?php esc_html_e( 'Keeps up to 1,000 latest workflow results for 30 days. This is an operational status view, not an email delivery log or a document archive. Opening an order here does not resend an email.', 'fullbleed-commerce-pro' ); ?></p>
    </div>
    <?php
}

add_action( 'init', __NAMESPACE__ . '\install' );
add_action( CLEANUP_HOOK, __NAMESPACE__ . '\prune' );
add_action( 'woocommerce_delete_order', __NAMESPACE__ . '\erase_order' );
add_action( 'woocommerce_trash_order', __NAMESPACE__ . '\erase_order' );
add_action( 'woocommerce_privacy_remove_order_personal_data', __NAMESPACE__ . '\erase_order' );
// Legacy order storage can also be deleted directly through WordPress.
add_action( 'before_delete_post', function ( $id, $post ) { if ( 'shop_order' === $post->post_type ) erase_order( $id ); }, 10, 2 );
add_action( 'trashed_post', function ( $id ) { if ( 'shop_order' === get_post_type( $id ) ) erase_order( $id ); } );
add_action( 'admin_menu', function () {
    add_submenu_page( 'woocommerce', __( 'Fullbleed activity', 'fullbleed-commerce-pro' ), __( 'Fullbleed activity', 'fullbleed-commerce-pro' ), 'manage_woocommerce', 'fullbleed-activity', __NAMESPACE__ . '\page' );
} );
add_action( 'admin_notices', __NAMESPACE__ . '\notice' );
add_action( 'admin_enqueue_scripts', function ( $hook ) {
    if ( 'woocommerce_page_fullbleed-activity' === $hook ) wp_enqueue_style( 'fullbleed-activity', plugins_url( 'assets/activity.css', __FILE__ ), array(), '1' );
} );
