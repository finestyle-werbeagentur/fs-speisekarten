<?php
/**
 * Updates kommen vom Finestyle Kundenpanel (panel.finestyle.eu → Plugin-Updates).
 * Nach einem Update werden einmalig Aufgaben erledigt (PDF-Ordner schützen, Karten zum Neu-Auslesen vormerken).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once FS_SK_DIR . 'finestyle-updater.php';
new Finestyle_Updater( FS_SK_DIR . 'fs-speisekarten.php', 'fs-speisekarten' );

/* Nach einem Update: einmalig Aufgaben erledigen (Ordner schützen, Karten zum Neu-Auslesen vormerken) */
add_action( 'admin_init', function () {
	$stored = get_option( 'fs_sk_version', '' );
	if ( FS_SK_VERSION === $stored ) {
		return;
	}
	update_option( 'fs_sk_version', FS_SK_VERSION, false );
	if ( function_exists( 'fs_sk_upload_dir' ) ) {
		$u = fs_sk_upload_dir();
		if ( is_dir( $u['dir'] ) ) {
			fs_sk_protect_dir( $u['dir'] );
		}
	}
	// Nur neu auslesen lassen, wenn sich das Auslesen selbst geändert hat
	if ( $stored && function_exists( 'fs_sk_outdated_cards' ) && fs_sk_outdated_cards() ) {
		update_option( 'fs_sk_reread_pending', FS_SK_PARSER, false );
	}
} );
