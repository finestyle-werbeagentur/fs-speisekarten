<?php
/**
 * Updates direkt von GitHub.
 *
 * Neue Version = neues „Release“ im GitHub-Repository mit der Datei fs-speisekarten.zip.
 * WordPress (und damit MainWP) zeigt dann auf jeder Seite ganz normal „Update verfügbar“ an.
 *
 * Optional in der wp-config.php:
 *   define( 'FS_SK_UPDATE_REPO', 'finestyle-werbeagentur/fs-speisekarten' ); // anderes Repository
 *   define( 'FS_SK_GITHUB_TOKEN', 'github_pat_…' );                         // nur bei privatem Repository
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'FS_SK_UPDATE_REPO' ) ) {
	define( 'FS_SK_UPDATE_REPO', 'finestyle-werbeagentur/fs-speisekarten' );
}

define( 'FS_SK_BASENAME', 'fs-speisekarten/fs-speisekarten.php' );

/** Zugangsschlüssel für ein privates Repository (wp-config.php oder Option). */
function fs_sk_gh_token() {
	if ( defined( 'FS_SK_GITHUB_TOKEN' ) && FS_SK_GITHUB_TOKEN ) {
		return FS_SK_GITHUB_TOKEN;
	}
	return (string) get_site_option( 'fs_sk_github_token', '' );
}

function fs_sk_gh_headers( $accept = 'application/vnd.github+json' ) {
	$h = array(
		'Accept'     => $accept,
		'User-Agent' => 'fs-speisekarten/' . FS_SK_VERSION,
	);
	$t = fs_sk_gh_token();
	if ( $t ) {
		$h['Authorization'] = 'Bearer ' . $t;
	}
	return $h;
}

/** Neuestes Release von GitHub holen (6 Stunden zwischengespeichert). */
function fs_sk_latest_release( $force = false ) {
	$cache = get_site_transient( 'fs_sk_release' );
	if ( ! $force && is_array( $cache ) ) {
		return $cache ? $cache : null;
	}
	$res = wp_remote_get(
		'https://api.github.com/repos/' . FS_SK_UPDATE_REPO . '/releases/latest',
		array( 'timeout' => 10, 'headers' => fs_sk_gh_headers() )
	);
	$out = array();
	if ( ! is_wp_error( $res ) && 200 === wp_remote_retrieve_response_code( $res ) ) {
		$rel = json_decode( wp_remote_retrieve_body( $res ), true );
		$zip = null;
		foreach ( (array) ( $rel['assets'] ?? array() ) as $a ) {
			if ( preg_match( '/\.zip$/i', $a['name'] ?? '' ) ) {
				$zip = $a;
				break;
			}
		}
		if ( $zip && ! empty( $rel['tag_name'] ) ) {
			$out = array(
				'version' => ltrim( $rel['tag_name'], 'vV' ),
				'zip'     => fs_sk_gh_token() ? $zip['url'] : $zip['browser_download_url'], // privat: über die API laden
				'notes'   => (string) ( $rel['body'] ?? '' ),
				'date'    => (string) ( $rel['published_at'] ?? '' ),
				'url'     => (string) ( $rel['html_url'] ?? '' ),
			);
		}
	}
	// auch „nichts gefunden“ merken, damit GitHub nicht bei jedem Seitenaufruf gefragt wird
	set_site_transient( 'fs_sk_release', $out, $out ? 6 * HOUR_IN_SECONDS : HOUR_IN_SECONDS );
	return $out ? $out : null;
}

/* Update in die normale WordPress-Update-Liste eintragen */
add_filter( 'pre_set_site_transient_update_plugins', function ( $transient ) {
	if ( empty( $transient ) || ! is_object( $transient ) ) {
		return $transient;
	}
	$rel = fs_sk_latest_release();
	$item = (object) array(
		'id'          => 'github.com/' . FS_SK_UPDATE_REPO,
		'slug'        => 'fs-speisekarten',
		'plugin'      => FS_SK_BASENAME,
		'new_version' => $rel ? $rel['version'] : FS_SK_VERSION,
		'url'         => 'https://finestyle.eu',
		'package'     => $rel ? $rel['zip'] : '',
		'tested'      => get_bloginfo( 'version' ),
		'icons'       => array(),
		'banners'     => array(),
	);
	if ( $rel && version_compare( $rel['version'], FS_SK_VERSION, '>' ) ) {
		$transient->response[ FS_SK_BASENAME ] = $item;
	} else {
		$transient->no_update[ FS_SK_BASENAME ] = $item;
	}
	return $transient;
} );

/* „Jetzt nach Updates suchen“ fragt auch GitHub neu */
add_action( 'load-update-core.php', function () {
	if ( ! empty( $_GET['force-check'] ) ) { // phpcs:ignore
		delete_site_transient( 'fs_sk_release' );
	}
} );

/* Fenster „Details ansehen“ in der Plugin-Liste */
add_filter( 'plugins_api', function ( $res, $action, $args ) {
	if ( 'plugin_information' !== $action || ( $args->slug ?? '' ) !== 'fs-speisekarten' ) {
		return $res;
	}
	$rel = fs_sk_latest_release();
	return (object) array(
		'name'          => 'Finestyle Speisekarten',
		'slug'          => 'fs-speisekarten',
		'version'       => $rel ? $rel['version'] : FS_SK_VERSION,
		'author'        => '<a href="https://finestyle.eu">Finestyle Werbeagentur</a>',
		'homepage'      => 'https://finestyle.eu',
		'last_updated'  => $rel ? $rel['date'] : '',
		'download_link' => $rel ? $rel['zip'] : '',
		'sections'      => array(
			'changelog' => $rel && $rel['notes'] ? wpautop( esc_html( $rel['notes'] ) ) : 'Keine Angaben.',
		),
	);
}, 10, 3 );

/* Bei privatem Repository: Download mit Zugangsschlüssel */
add_filter( 'http_request_args', function ( $args, $url ) {
	if ( fs_sk_gh_token() && 0 === strpos( $url, 'https://api.github.com/repos/' . FS_SK_UPDATE_REPO . '/releases/assets/' ) ) {
		$args['headers'] = array_merge( (array) ( $args['headers'] ?? array() ), fs_sk_gh_headers( 'application/octet-stream' ) );
	}
	return $args;
}, 10, 2 );

/* Ordnername nach dem Entpacken sicherstellen (falls die ZIP anders heißt) */
add_filter( 'upgrader_source_selection', function ( $source, $remote_source, $upgrader, $hook_extra = array() ) {
	global $wp_filesystem;
	if ( ( $hook_extra['plugin'] ?? '' ) !== FS_SK_BASENAME || ! $wp_filesystem ) {
		return $source;
	}
	$want = trailingslashit( $remote_source ) . 'fs-speisekarten/';
	if ( untrailingslashit( $source ) !== untrailingslashit( $want ) && $wp_filesystem->move( $source, $want ) ) {
		return $want;
	}
	return $source;
}, 10, 4 );

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
	if ( $stored ) {
		update_option( 'fs_sk_reread_pending', FS_SK_VERSION, false ); // wird in Schritt 3 genutzt
	}
} );
