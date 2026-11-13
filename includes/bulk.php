<?php
/**
 * Alle Speisekarten auf einmal neu auslesen (z. B. nach einem Plugin-Update).
 * Das Auslesen selbst läuft im Browser (assets/bulk.js), gespeichert wird hier.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Karten, die mit einer älteren Plugin-Version ausgelesen wurden. */
function fs_sk_outdated_cards() {
	$ids = get_posts( array(
		'post_type'      => FS_SK_CPT,
		'post_status'    => array( 'publish', 'draft', 'private', 'pending' ),
		'posts_per_page' => -1,
		'fields'         => 'ids',
	) );
	return array_values( array_filter( $ids, function ( $id ) {
		return fs_sk_pdf_url( $id, false ) && version_compare( (string) get_post_meta( $id, '_fs_sk_parser', true ), FS_SK_PARSER, '<' );
	} ) );
}

add_action( 'admin_menu', function () {
	add_submenu_page(
		'edit.php?post_type=' . FS_SK_CPT,
		'Alle neu auslesen',
		'Alle neu auslesen',
		'edit_posts',
		'fs-sk-bulk',
		'fs_sk_render_bulk_page'
	);
} );

/* Hinweis oben im Backend, solange Karten nach einem Update noch nicht neu ausgelesen sind */
add_action( 'admin_notices', function () {
	if ( ! current_user_can( 'edit_posts' ) || ! get_option( 'fs_sk_reread_pending' ) ) {
		return;
	}
	$screen = get_current_screen();
	if ( $screen && 'fs_speisekarte_page_fs-sk-bulk' === $screen->id ) {
		return;
	}
	$n = count( fs_sk_outdated_cards() );
	if ( ! $n ) {
		delete_option( 'fs_sk_reread_pending' );
		return;
	}
	printf(
		'<div class="notice notice-info"><p><strong>Finestyle Speisekarten wurde aktualisiert.</strong> %s mit der neuen Version auslesen, damit sie vom verbesserten Erkennen profitieren. Deine Handkorrekturen bleiben erhalten. <a class="button button-primary" href="%s">Jetzt neu auslesen</a></p></div>',
		esc_html( 1 === $n ? '1 Speisekarte' : $n . ' Speisekarten' ),
		esc_url( admin_url( 'edit.php?post_type=' . FS_SK_CPT . '&page=fs-sk-bulk&start=1' ) )
	);
} );

function fs_sk_render_bulk_page() {
	$cards = array();
	$ids   = get_posts( array(
		'post_type'      => FS_SK_CPT,
		'post_status'    => array( 'publish', 'draft', 'private', 'pending' ),
		'posts_per_page' => -1,
		'fields'         => 'ids',
	) );
	foreach ( $ids as $id ) {
		$url = fs_sk_pdf_url( $id, false );
		if ( ! $url ) {
			continue;
		}
		$cards[] = array(
			'id'       => $id,
			'title'    => get_the_title( $id ),
			'pdfUrl'   => $url,
			'outdated' => version_compare( (string) get_post_meta( $id, '_fs_sk_parser', true ), FS_SK_PARSER, '<' ),
			'edit'     => get_edit_post_link( $id, 'raw' ),
		);
	}
	$init = array(
		'cards'   => $cards,
		'ajax'    => admin_url( 'admin-ajax.php' ),
		'nonce'   => wp_create_nonce( 'fs_sk_bulk' ),
		'start'   => ! empty( $_GET['start'] ), // phpcs:ignore
		'version' => FS_SK_VERSION,
	);
	?>
	<div class="wrap fs-sk-admin fs-bulk">
		<h1>Alle Speisekarten neu auslesen</h1>
		<p class="fs-bulk__intro">Hier liest du alle PDFs mit der aktuellen Version (<?php echo esc_html( FS_SK_PARSER ); ?>) neu aus. <strong>Was du von Hand korrigiert hast, bleibt erhalten.</strong> Lass diese Seite offen, bis alle Karten fertig sind.</p>
		<script type="application/json" id="fs-bulk-init"><?php echo wp_json_encode( $init, JSON_HEX_TAG | JSON_HEX_AMP ); ?></script>
		<p><button type="button" class="button button-primary button-hero" id="fs-bulk-run">Alle neu auslesen</button>
			<label style="margin-left:12px"><input type="checkbox" id="fs-bulk-all"> auch Karten, die schon aktuell sind</label></p>
		<ul class="fs-bulk__list" id="fs-bulk-list"></ul>
	</div>
	<?php
}

add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( 'fs_speisekarte_page_fs-sk-bulk' !== $hook ) {
		return;
	}
	wp_enqueue_style( 'fs-sk-admin', FS_SK_URL . 'assets/admin.css', array(), FS_SK_VERSION );
} );

add_action( 'admin_print_footer_scripts', function () {
	$screen = get_current_screen();
	if ( ! $screen || 'fs_speisekarte_page_fs-sk-bulk' !== $screen->id ) {
		return;
	}
	printf( '<script type="module" src="%s"></script>' . "\n", esc_url( FS_SK_URL . 'assets/bulk.js?ver=' . FS_SK_VERSION ) );
} );

/* Daten einer Karte holen */
add_action( 'wp_ajax_fs_sk_bulk_get', function () {
	check_ajax_referer( 'fs_sk_bulk', 'nonce' );
	$id = (int) ( $_POST['id'] ?? 0 );
	if ( ! $id || FS_SK_CPT !== get_post_type( $id ) || ! current_user_can( 'edit_post', $id ) ) {
		wp_send_json_error( 'Keine Berechtigung' );
	}
	wp_send_json_success( array(
		'data' => fs_sk_get_data( $id ),
		'auto' => fs_sk_get_auto( $id ),
	) );
} );

/* Neu ausgelesene Karte speichern */
add_action( 'wp_ajax_fs_sk_bulk_save', function () {
	check_ajax_referer( 'fs_sk_bulk', 'nonce' );
	$id = (int) ( $_POST['id'] ?? 0 );
	if ( ! $id || FS_SK_CPT !== get_post_type( $id ) || ! current_user_can( 'edit_post', $id ) ) {
		wp_send_json_error( 'Keine Berechtigung' );
	}
	$data = json_decode( wp_unslash( $_POST['data'] ?? '' ), true ); // phpcs:ignore -- wird bereinigt
	$auto = json_decode( wp_unslash( $_POST['auto'] ?? '' ), true ); // phpcs:ignore -- wird bereinigt
	if ( ! is_array( $data ) || ! is_array( $auto ) || empty( $data['sections'] ) ) {
		wp_send_json_error( 'Leeres Ergebnis' );
	}
	update_post_meta( $id, '_fs_sk_data', wp_slash( wp_json_encode( fs_sk_sanitize_data( $data ), JSON_UNESCAPED_UNICODE ) ) );
	fs_sk_save_auto( $id, $auto );
	fs_sk_purge_caches();
	if ( 'publish' === get_post_status( $id ) && function_exists( 'fs_sk_google_queue' ) ) {
		fs_sk_google_queue( 20 );
	}
	if ( ! fs_sk_outdated_cards() ) {
		delete_option( 'fs_sk_reread_pending' );
	}
	wp_send_json_success();
} );
