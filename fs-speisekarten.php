<?php
/**
 * Plugin Name:       Finestyle Speisekarten
 * Description:       Speisekarte als PDF hochladen – wird automatisch als sauberes HTML (gut für Google) auf der Seite ausgegeben und die PDF bleibt per Button im Browser abrufbar.
 * Version:           1.7.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Finestyle Werbeagentur
 * Author URI:        https://finestyle.eu
 * Text Domain:       fs-speisekarten
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FS_SK_VERSION', '1.7.0' );
define( 'FS_SK_URL', plugin_dir_url( __FILE__ ) );
define( 'FS_SK_DIR', plugin_dir_path( __FILE__ ) );
define( 'FS_SK_CPT', 'fs_speisekarte' );

require_once FS_SK_DIR . 'includes/updater.php';
require_once FS_SK_DIR . 'includes/bulk.php';

/** PDFs im Browser öffnen statt herunterladen (falls der Server mod_headers kann). */
function fs_sk_protect_dir( $dir ) {
	$ht = trailingslashit( $dir ) . '.htaccess';
	if ( ! file_exists( $ht ) ) {
		@file_put_contents( $ht, "<IfModule mod_headers.c>\n<FilesMatch \"\\.pdf$\">\nHeader set Content-Disposition inline\nHeader set X-Robots-Tag \"noindex\"\n</FilesMatch>\n</IfModule>\n" ); // phpcs:ignore
	}
}

/* -------------------------------------------------------------------------
 * 1. Inhaltstyp „Speisekarten“
 * ---------------------------------------------------------------------- */
add_action( 'init', function () {
	register_post_type( FS_SK_CPT, array(
		'labels'          => array(
			'name'               => 'Speisekarten',
			'singular_name'      => 'Speisekarte',
			'add_new'            => 'Neue Speisekarte',
			'add_new_item'       => 'Neue Speisekarte anlegen',
			'edit_item'          => 'Speisekarte bearbeiten',
			'all_items'          => 'Alle Speisekarten',
			'search_items'       => 'Speisekarten suchen',
			'not_found'          => 'Noch keine Speisekarte angelegt.',
			'menu_name'          => 'Speisekarten',
		),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'show_in_rest'    => false,
		'menu_icon'       => 'dashicons-media-document',
		'menu_position'   => 25,
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'map_meta_cap'    => true,
	) );
} );

add_filter( 'enter_title_here', function ( $text, $post ) {
	return ( $post && FS_SK_CPT === $post->post_type ) ? 'Name der Karte, z. B. „Speisekarte“ oder „Getränkekarte“' : $text;
}, 10, 2 );

/* Formular braucht multipart für den PDF-Upload */
add_action( 'post_edit_form_tag', function ( $post ) {
	if ( $post && FS_SK_CPT === $post->post_type ) {
		echo ' enctype="multipart/form-data"';
	}
} );

/* -------------------------------------------------------------------------
 * 2. Hilfsfunktionen
 * ---------------------------------------------------------------------- */
function fs_sk_save_auto( $post_id, $auto ) {
	update_post_meta( $post_id, '_fs_sk_auto', wp_slash( wp_json_encode( fs_sk_sanitize_data( $auto ), JSON_UNESCAPED_UNICODE ) ) );
	update_post_meta( $post_id, '_fs_sk_parser', FS_SK_VERSION );
}

/** Reines Auslese-Ergebnis vom letzten Mal (Vergleichsbasis für Handkorrekturen). */
function fs_sk_get_auto( $post_id ) {
	$raw = get_post_meta( $post_id, '_fs_sk_auto', true );
	$a   = $raw ? json_decode( $raw, true ) : null;
	return is_array( $a ) ? $a : null;
}

function fs_sk_get_data( $post_id ) {
	$raw  = get_post_meta( $post_id, '_fs_sk_data', true );
	$data = $raw ? json_decode( $raw, true ) : null;
	if ( ! is_array( $data ) ) {
		$data = array( 'sections' => array(), 'notes' => array() );
	}
	return $data;
}

function fs_sk_upload_dir() {
	$up = wp_upload_dir();
	return array(
		'dir' => trailingslashit( $up['basedir'] ) . 'speisekarten',
		'url' => trailingslashit( $up['baseurl'] ) . 'speisekarten',
	);
}

function fs_sk_filename( $post_id ) {
	$name = get_post_meta( $post_id, '_fs_sk_filename', true );
	// Platzhalter-Namen von WordPress-Entwürfen nicht als Dateinamen verwenden
	if ( in_array( $name, array( 'automatischer-entwurf', 'auto-draft', 'entwurf' ), true ) ) {
		$name = '';
	}
	if ( ! $name ) {
		$post = get_post( $post_id );
		$name = $post ? sanitize_title( $post->post_title ) : '';
	}
	$name = sanitize_file_name( preg_replace( '/\.pdf$/i', '', (string) $name ) );
	return $name ? $name : 'speisekarte-' . $post_id;
}

function fs_sk_pdf_url( $post_id, $cachebust = true ) {
	$file = get_post_meta( $post_id, '_fs_sk_file', true );
	if ( ! $file ) {
		return '';
	}
	$u = fs_sk_upload_dir();
	if ( ! file_exists( $u['dir'] . '/' . $file ) ) {
		return '';
	}
	$url = $u['url'] . '/' . rawurlencode( $file );
	if ( $cachebust ) {
		$url = add_query_arg( 'v', (int) get_post_meta( $post_id, '_fs_sk_updated', true ), $url );
	}
	return $url;
}

/** Bereinigt die vom Editor kommende Struktur. */
function fs_sk_sanitize_data( $data ) {
	$clean = array( 'sections' => array(), 'notes' => array() );
	if ( ! is_array( $data ) ) {
		return $clean;
	}
	$t  = function ( $v, $max = 300 ) {
		return mb_substr( sanitize_text_field( (string) $v ), 0, $max );
	};
	$ta = function ( $v ) {
		return mb_substr( trim( preg_replace( '/\s+/u', ' ', sanitize_textarea_field( (string) $v ) ) ), 0, 2000 );
	};
	// Schlüssel zum Wiedererkennen beim Neu-Auslesen (Handkorrekturen bleiben erhalten)
	$key = function ( $arr, $target ) {
		$k = preg_replace( '/[^a-z0-9_]/', '', strtolower( (string) ( $arr['k'] ?? '' ) ) );
		if ( '' !== $k ) {
			$target['k'] = substr( $k, 0, 40 );
		}
		return $target;
	};
	foreach ( (array) ( $data['sections'] ?? array() ) as $s ) {
		if ( ! is_array( $s ) ) {
			continue;
		}
		$sec = array(
			'title' => $t( $s['title'] ?? '' ),
			'note'  => $ta( $s['note'] ?? '' ),
			'title2' => $t( $s['title2'] ?? '' ),
			'note2'  => $ta( $s['note2'] ?? '' ),
			'items' => array(),
		);
		foreach ( (array) ( $s['items'] ?? array() ) as $i ) {
			if ( ! is_array( $i ) ) {
				continue;
			}
			if ( 'sub' === ( $i['type'] ?? '' ) ) {
				$name = $t( $i['name'] ?? '' );
				if ( '' !== $name ) {
					$sub = array( 'type' => 'sub', 'name' => $name );
					if ( ! empty( $i['extra'] ) ) {
						$sub['extra'] = true;
					}
					if ( '' !== $t( $i['name2'] ?? '' ) ) {
						$sub['name2'] = $t( $i['name2'] );
					}
					$sec['items'][] = $key( $i, $sub );
				}
				continue;
			}
			$item = array(
				'veg'      => in_array( $i['veg'] ?? '', array( 'vegetarisch', 'vegan' ), true ) ? $i['veg'] : '',
				'spice'    => max( 0, min( 3, (int) ( $i['spice'] ?? 0 ) ) ),
				'badge'    => $t( $i['badge'] ?? '', 20 ),
				'nr'       => $t( $i['nr'] ?? '', 20 ),
				'name'     => $t( $i['name'] ?? '' ),
				'name2'    => $t( $i['name2'] ?? '' ),
				'sup'      => $t( $i['sup'] ?? '', 60 ),
				'desc'     => $ta( $i['desc'] ?? '' ),
				'desc2'    => $ta( $i['desc2'] ?? '' ),
				'variants' => array(),
			);
			foreach ( (array) ( $i['variants'] ?? array() ) as $v ) {
				if ( ! is_array( $v ) ) {
					continue;
				}
				$size  = $t( $v['size'] ?? '', 60 );
				$price = $t( $v['price'] ?? '', 30 );
				if ( '' !== $size || '' !== $price ) {
					$item['variants'][] = array( 'size' => $size, 'price' => $price );
				}
			}
			if ( '' !== $item['name'] || '' !== $item['desc'] || $item['variants'] ) {
				$sec['items'][] = $key( $i, $item );
			}
		}
		if ( '' !== $sec['title'] || '' !== $sec['note'] || $sec['items'] ) {
			$clean['sections'][] = $key( $s, $sec );
		}
	}
	foreach ( (array) ( $data['colors'] ?? array() ) as $k => $c ) {
		$c = sanitize_hex_color( (string) $c );
		if ( $c && in_array( $k, array( 'title', 'accent', 'veg', 'chili' ), true ) ) {
			$clean['colors'][ $k ] = $c;
		}
	}
	if ( in_array( $data['caps'] ?? '', array( 'head', 'all' ), true ) ) {
		$clean['caps'] = $data['caps'];
	}
	if ( 'en' === ( $data['lang2'] ?? '' ) ) {
		$clean['lang2'] = 'en';
	}
	foreach ( (array) ( $data['notes'] ?? array() ) as $n ) {
		$n = $ta( $n );
		if ( '' !== $n ) {
			$clean['notes'][] = $n;
		}
	}
	return $clean;
}

/* -------------------------------------------------------------------------
 * 3. Bearbeiten-Seite
 * ---------------------------------------------------------------------- */
add_action( 'add_meta_boxes_' . FS_SK_CPT, function () {
	add_meta_box( 'fs_sk_box', 'Speisekarte', 'fs_sk_render_box', FS_SK_CPT, 'normal', 'high' );
	add_meta_box( 'fs_sk_side', 'Auf der Webseite einbinden', 'fs_sk_render_side', FS_SK_CPT, 'side', 'high' );
	remove_meta_box( 'slugdiv', FS_SK_CPT, 'normal' );
} );

function fs_sk_render_box( $post ) {
	wp_nonce_field( 'fs_sk_save', 'fs_sk_nonce' );
	$data     = fs_sk_get_data( $post->ID );
	$pdf_url  = fs_sk_pdf_url( $post->ID, false );
	$updated  = (int) get_post_meta( $post->ID, '_fs_sk_updated', true );
	$filename = fs_sk_filename( $post->ID );
	$initial  = array(
		'data'     => $data,
		'auto'     => fs_sk_get_auto( $post->ID ),
		'pdfUrl'   => $pdf_url,
		'updated'  => $updated ? wp_date( 'd.m.Y \u\m H:i \U\h\r', $updated ) : '',
		'postId'   => $post->ID,
		'filename' => $filename,
		'saved'    => isset( $_GET['fs_sk'] ) ? sanitize_key( $_GET['fs_sk'] ) : '', // phpcs:ignore
	);
	?>
	<div id="fs-sk-app" class="fs-sk-admin">
		<script type="application/json" id="fs-sk-initial"><?php echo wp_json_encode( $initial, JSON_HEX_TAG | JSON_HEX_AMP ); ?></script>
		<input type="hidden" name="fs_sk_data" id="fs-sk-data" value="<?php echo esc_attr( wp_json_encode( $data ) ); ?>">
		<input type="hidden" name="fs_sk_auto" id="fs-sk-auto" value="">

		<!-- Schritt 1 -->
		<div class="fs-step">
			<div class="fs-step__num">1</div>
			<div class="fs-step__body">
				<h3>PDF hochladen</h3>
				<label class="fs-drop" id="fs-sk-drop">
					<input type="file" name="fs_sk_pdf" id="fs-sk-file" accept="application/pdf,.pdf">
					<span class="fs-drop__big">Lade hier deine Speisekarte als PDF hoch</span>
					<span class="fs-drop__small">Datei hierher ziehen oder klicken. Der Text wird automatisch ausgelesen.</span>
				</label>
				<div class="fs-status" id="fs-sk-status" hidden></div>
				<div class="fs-current-row">
					<p class="fs-current" id="fs-sk-current"></p>
					<button type="button" class="button" id="fs-sk-reread" hidden title="Liest die gespeicherte PDF nach dem neuesten Stand des Plugins neu aus – ohne neuen Upload">PDF neu auslesen</button>
				</div>
			</div>
		</div>

		<!-- Aussehen -->
		<?php $st = fs_sk_get_style( $post->ID ); ?>
		<div class="fs-step">
			<div class="fs-step__num">2</div>
			<div class="fs-step__body">
				<div class="fs-step__head">
					<h3>Aussehen</h3>
					<button type="button" class="button" id="fs-sk-pdfcolors" hidden>Stil aus der PDF übernehmen</button>
				</div>
				<div class="fs-grid">
					<p class="fs-field">
						<label for="fs-st-layout">Bereiche</label>
						<select id="fs-st-layout" name="fs_sk_style[layout]">
							<option value="aufklappbar" <?php selected( $st['layout'], 'aufklappbar' ); ?>>Zugeklappt – öffnen per Klick</option>
							<option value="offen" <?php selected( $st['layout'], 'offen' ); ?>>Alles offen</option>
						</select>
					</p>
					<p class="fs-field">
						<label for="fs-st-size">Schriftgröße</label>
						<select id="fs-st-size" name="fs_sk_style[size]">
							<option value="klein" <?php selected( $st['size'], 'klein' ); ?>>Etwas kleiner</option>
							<option value="normal" <?php selected( $st['size'], 'normal' ); ?>>Normal</option>
							<option value="gross" <?php selected( $st['size'], 'gross' ); ?>>Etwas größer</option>
						</select>
					</p>
					<p class="fs-field">
						<label for="fs-st-caps">Schreibweise</label>
						<select id="fs-st-caps" name="fs_sk_style[caps]">
							<option value="" <?php selected( $st['caps'], '' ); ?>>Normal (Groß- und Kleinschreibung)</option>
							<option value="head" <?php selected( $st['caps'], 'head' ); ?>>Überschriften in GROSSBUCHSTABEN</option>
							<option value="all" <?php selected( $st['caps'], 'all' ); ?>>Überschriften und Namen in GROSSBUCHSTABEN</option>
						</select>
					</p>
					<?php foreach ( array( 'font_head' => 'Schrift Überschriften', 'font_text' => 'Schrift Text' ) as $fk => $fl ) : ?>
					<p class="fs-field">
						<label for="fs-st-<?php echo esc_attr( $fk ); ?>"><?php echo esc_html( $fl ); ?></label>
						<select id="fs-st-<?php echo esc_attr( $fk ); ?>" name="fs_sk_style[<?php echo esc_attr( $fk ); ?>]" class="fs-font-select">
							<?php foreach ( fs_sk_font_options() as $ov => $ol ) : ?>
								<option value="<?php echo esc_attr( $ov ); ?>" <?php selected( $st[ $fk ], $ov ); ?>><?php echo esc_html( $ol ); ?></option>
							<?php endforeach; ?>
						</select>
						<input type="text" class="fs-font-custom" name="fs_sk_style[<?php echo esc_attr( $fk ); ?>_custom]" value="<?php echo esc_attr( $st[ $fk . '_custom' ] ); ?>" placeholder="z. B. Adelle, Georgia, serif" <?php echo 'custom' === $st[ $fk ] ? '' : 'hidden'; ?>>
					</p>
					<?php endforeach; ?>
				</div>
				<p class="fs-small">„Eigene Schrift“: Trag den Namen einer Schrift ein, die auf der Webseite schon eingebunden ist (z. B. in Elementor unter „Eigene Schriftarten“).</p>
				<div class="fs-colors">
					<?php
					$color_fields = array(
						'title'    => 'Überschriften',
						'accent'   => 'Nummern & Zwischenzeilen',
						'btn_bg'   => 'Button',
						'btn_text' => 'Button-Schrift',
						'veg'      => 'Blatt (vegetarisch)',
						'chili'    => 'Chili (scharf)',
					);
					foreach ( $color_fields as $ck => $cl ) :
						?>
						<div class="fs-color" data-key="<?php echo esc_attr( $ck ); ?>">
							<span class="fs-color__l"><?php echo esc_html( $cl ); ?></span>
							<span class="fs-color__row">
								<input type="color" value="<?php echo esc_attr( $st[ $ck ] ? $st[ $ck ] : '#888888' ); ?>" aria-label="<?php echo esc_attr( $cl ); ?>">
								<input type="hidden" name="fs_sk_style[<?php echo esc_attr( $ck ); ?>]" value="<?php echo esc_attr( $st[ $ck ] ); ?>">
								<span class="fs-color__state"><?php echo $st[ $ck ] ? esc_html( $st[ $ck ] ) : 'Standard'; ?></span>
								<button type="button" class="fs-link fs-color__reset" <?php echo $st[ $ck ] ? '' : 'hidden'; ?>>zurücksetzen</button>
							</span>
						</div>
					<?php endforeach; ?>
				</div>
			</div>
		</div>

		<!-- Schritt 3 -->
		<div class="fs-step">
			<div class="fs-step__num">3</div>
			<div class="fs-step__body">
				<div class="fs-step__head">
					<h3>Prüfen und korrigieren</h3>
					<div class="fs-tabs" role="tablist">
						<button type="button" class="fs-tab is-on" data-tab="edit">Bearbeiten</button>
						<button type="button" class="fs-tab" data-tab="preview">Vorschau</button>
					</div>
				</div>
				<p class="fs-hint">Schau kurz drüber: Gelb markierte Einträge haben keinen Preis. Falsch erkannte Zeilen kannst du hier direkt ändern, verschieben oder löschen. Hochgestellte Zeichen schreibst du in geschweifte Klammern, z. B. <code>Cola{1,2}</code>.</p>
				<div id="fs-sk-editor" class="fs-editor"></div>
				<div id="fs-sk-preview" class="fs-preview" hidden></div>
			</div>
		</div>

	</div>
	<?php
}

/** Seitenleiste: Shortcode, PDF-Link, Dateiname – immer oben griffbereit. */
function fs_sk_render_side( $post ) {
	$pdf_url  = fs_sk_pdf_url( $post->ID, false );
	$filename = fs_sk_filename( $post->ID );
	$code     = '[speisekarte id="' . (int) $post->ID . '"]';
	$code_btn = '[speisekarte_pdf id="' . (int) $post->ID . '"]';
	?>
	<div class="fs-sk-admin fs-side">
		<p class="fs-side__l">Shortcode für die Karte</p>
		<div class="fs-copy fs-copy--side"><code><?php echo esc_html( $code ); ?></code><button type="button" class="button button-small" data-copy="<?php echo esc_attr( $code ); ?>">Kopieren</button></div>
		<p class="fs-small">In Elementor ein <strong>Shortcode-Widget</strong> einfügen und den Code hineinkopieren.</p>

		<p class="fs-side__l">Nur Download-Button</p>
		<div class="fs-copy fs-copy--side"><code><?php echo esc_html( $code_btn ); ?></code><button type="button" class="button button-small" data-copy="<?php echo esc_attr( $code_btn ); ?>">Kopieren</button></div>

		<?php if ( $pdf_url ) : ?>
			<p class="fs-side__l">Link zur PDF</p>
			<div class="fs-copy fs-copy--side"><code><?php echo esc_html( wp_basename( $pdf_url ) ); ?></code><button type="button" class="button button-small" data-copy="<?php echo esc_attr( $pdf_url ); ?>">Kopieren</button></div>
		<?php endif; ?>

		<p class="fs-side__l"><label for="fs-sk-filename">Dateiname der PDF</label></p>
		<span class="fs-inline"><input type="text" id="fs-sk-filename" name="fs_sk_filename" value="<?php echo esc_attr( $filename ); ?>"><code>.pdf</code></span>
		<p class="fs-small">Bleibt bei jedem Update gleich – Links und Google-Einträge funktionieren weiter.</p>

		<p class="fs-side__save">Änderungen werden erst gespeichert, wenn du oben auf <strong>„Aktualisieren“</strong> klickst.</p>

		<details class="fs-more">
			<summary>Weitere Shortcode-Einstellungen</summary>
			<ul>
				<li><code>download="unten"</code> · <code>"aus"</code> – PDF-Button unten oder gar nicht</li>
				<li><code>darstellung="offen"</code> – alle Bereiche offen</li>
				<li><code>navigation="ja"</code> – Sprungmarken über der Karte</li>
				<li><code>nummern="aus"</code> – Nummern ausblenden</li>
				<li><code>preise="original"</code> – Preise wie in der PDF</li>
				<li><code>legende="unten"</code> · <code>"aus"</code> – Zeichenerklärung</li>
				<li><code>zusatzstoffe="aus"</code> – Zusatzstoffe ausblenden</li>
				<li><code>button="Unsere Karte als PDF"</code> – Text des Buttons</li>
			</ul>
		</details>
	</div>
	<?php
}

/* Admin-Skripte nur auf unserer Bearbeiten-Seite */
add_action( 'admin_enqueue_scripts', function ( $hook ) {
	$screen = get_current_screen();
	if ( ! $screen || FS_SK_CPT !== $screen->post_type || ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
		return;
	}
	wp_enqueue_style( 'fs-sk-admin', FS_SK_URL . 'assets/admin.css', array(), FS_SK_VERSION );
	wp_enqueue_style( 'fs-sk-front', FS_SK_URL . 'assets/frontend.css', array(), FS_SK_VERSION );
} );

add_action( 'admin_print_footer_scripts', function () {
	$screen = get_current_screen();
	if ( ! $screen || FS_SK_CPT !== $screen->post_type || 'post' !== $screen->base ) {
		return;
	}
	printf( '<script type="module" src="%s"></script>' . "\n", esc_url( FS_SK_URL . 'assets/admin.js?ver=' . FS_SK_VERSION ) );
} );

/* -------------------------------------------------------------------------
 * 4. Speichern
 * ---------------------------------------------------------------------- */
add_action( 'save_post_' . FS_SK_CPT, function ( $post_id ) {
	if ( ! isset( $_POST['fs_sk_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fs_sk_nonce'] ) ), 'fs_sk_save' ) ) {
		return;
	}
	if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}

	// Dateiname
	if ( isset( $_POST['fs_sk_filename'] ) ) {
		$fn = sanitize_title( wp_unslash( $_POST['fs_sk_filename'] ) );
		if ( in_array( $fn, array( 'automatischer-entwurf', 'auto-draft', 'entwurf' ), true ) ) {
			$fn = ''; // dann gilt der Titel der Karte
		}
		update_post_meta( $post_id, '_fs_sk_filename', $fn );
	}

	// Aussehen
	if ( isset( $_POST['fs_sk_style'] ) ) {
		update_post_meta( $post_id, '_fs_sk_style', fs_sk_sanitize_style( wp_unslash( $_POST['fs_sk_style'] ) ) ); // phpcs:ignore -- wird bereinigt
	}

	// Inhalt der Karte
	if ( isset( $_POST['fs_sk_data'] ) ) {
		$data = json_decode( wp_unslash( $_POST['fs_sk_data'] ), true ); // phpcs:ignore -- wird unten bereinigt
		update_post_meta( $post_id, '_fs_sk_data', wp_slash( wp_json_encode( fs_sk_sanitize_data( $data ), JSON_UNESCAPED_UNICODE ) ) );
		if ( ! empty( $_POST['fs_sk_auto'] ) ) {
			$auto = json_decode( wp_unslash( $_POST['fs_sk_auto'] ), true ); // phpcs:ignore -- wird bereinigt
			if ( is_array( $auto ) ) {
				fs_sk_save_auto( $post_id, $auto );
			}
		}
		update_post_meta( $post_id, '_fs_sk_updated', time() );
	}

	// PDF-Datei
	if ( ! empty( $_FILES['fs_sk_pdf']['tmp_name'] ) && is_uploaded_file( $_FILES['fs_sk_pdf']['tmp_name'] ) ) {
		$tmp  = $_FILES['fs_sk_pdf']['tmp_name'];
		$name = isset( $_FILES['fs_sk_pdf']['name'] ) ? sanitize_file_name( wp_unslash( $_FILES['fs_sk_pdf']['name'] ) ) : '';
		$head = file_get_contents( $tmp, false, null, 0, 5 ); // phpcs:ignore
		if ( '%PDF-' !== $head || ! preg_match( '/\.pdf$/i', $name ) ) {
			set_transient( 'fs_sk_msg_' . get_current_user_id(), 'nopdf', 60 );
			return;
		}
		$u = fs_sk_upload_dir();
		if ( ! wp_mkdir_p( $u['dir'] ) ) {
			set_transient( 'fs_sk_msg_' . get_current_user_id(), 'nodir', 60 );
			return;
		}
		fs_sk_protect_dir( $u['dir'] );
		$file = fs_sk_filename( $post_id ) . '.pdf';
		// alte Datei mit anderem Namen aufräumen
		$old = get_post_meta( $post_id, '_fs_sk_file', true );
		if ( $old && $old !== $file && file_exists( $u['dir'] . '/' . $old ) ) {
			wp_delete_file( $u['dir'] . '/' . $old );
		}
		if ( @move_uploaded_file( $tmp, $u['dir'] . '/' . $file ) ) { // phpcs:ignore
			@chmod( $u['dir'] . '/' . $file, 0644 ); // phpcs:ignore
			update_post_meta( $post_id, '_fs_sk_file', $file );
			update_post_meta( $post_id, '_fs_sk_updated', time() );
			set_transient( 'fs_sk_msg_' . get_current_user_id(), 'ok', 60 );
		} else {
			set_transient( 'fs_sk_msg_' . get_current_user_id(), 'nomove', 60 );
		}
	} elseif ( isset( $_POST['fs_sk_filename'] ) ) {
		// Dateiname geändert, aber keine neue PDF → vorhandene Datei umbenennen
		$u    = fs_sk_upload_dir();
		$old  = get_post_meta( $post_id, '_fs_sk_file', true );
		$file = fs_sk_filename( $post_id ) . '.pdf';
		if ( $old && $old !== $file && file_exists( $u['dir'] . '/' . $old ) && ! file_exists( $u['dir'] . '/' . $file ) ) {
			if ( @rename( $u['dir'] . '/' . $old, $u['dir'] . '/' . $file ) ) { // phpcs:ignore
				update_post_meta( $post_id, '_fs_sk_file', $file );
			}
		}
	}

	fs_sk_purge_caches();
} );

/** Gängige Cache-Plugins leeren, damit die neue Karte sofort sichtbar ist. */
function fs_sk_purge_caches() {
	if ( function_exists( 'rocket_clean_domain' ) ) {
		rocket_clean_domain();
	}
	if ( function_exists( 'w3tc_flush_all' ) ) {
		w3tc_flush_all();
	}
	if ( function_exists( 'wp_cache_clear_cache' ) ) {
		wp_cache_clear_cache();
	}
	do_action( 'litespeed_purge_all' );
	if ( class_exists( 'autoptimizeCache' ) && method_exists( 'autoptimizeCache', 'clearall' ) ) {
		autoptimizeCache::clearall();
	}
}

add_action( 'admin_notices', function () {
	$screen = get_current_screen();
	if ( ! $screen || FS_SK_CPT !== $screen->post_type ) {
		return;
	}
	$key = 'fs_sk_msg_' . get_current_user_id();
	$msg = get_transient( $key );
	if ( ! $msg ) {
		return;
	}
	delete_transient( $key );
	$texts = array(
		'ok'     => array( 'success', 'Fertig! Die neue PDF ist online und die Karte auf der Webseite ist aktualisiert.' ),
		'nopdf'  => array( 'error', 'Das war keine PDF-Datei. Bitte lade eine .pdf hoch.' ),
		'nodir'  => array( 'error', 'Der Ordner für die PDF konnte nicht angelegt werden (wp-content/uploads/speisekarten). Bitte Schreibrechte prüfen.' ),
		'nomove' => array( 'error', 'Die PDF konnte nicht gespeichert werden. Bitte Schreibrechte im Upload-Ordner prüfen.' ),
	);
	if ( isset( $texts[ $msg ] ) ) {
		printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', esc_attr( $texts[ $msg ][0] ), esc_html( $texts[ $msg ][1] ) );
	}
} );

/* Übersicht: Spalten mit Shortcode und Stand */
add_filter( 'manage_' . FS_SK_CPT . '_posts_columns', function ( $cols ) {
	$new = array();
	foreach ( $cols as $k => $v ) {
		$new[ $k ] = $v;
		if ( 'title' === $k ) {
			$new['fs_sk_code'] = 'Shortcode';
			$new['fs_sk_pdf']  = 'PDF';
		}
	}
	unset( $new['date'] );
	$new['fs_sk_upd'] = 'Zuletzt aktualisiert';
	return $new;
} );
add_action( 'manage_' . FS_SK_CPT . '_posts_custom_column', function ( $col, $post_id ) {
	if ( 'fs_sk_code' === $col ) {
		echo '<code>[speisekarte id="' . (int) $post_id . '"]</code>';
	} elseif ( 'fs_sk_pdf' === $col ) {
		$url = fs_sk_pdf_url( $post_id );
		echo $url ? '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener">PDF ansehen</a>' : '—';
	} elseif ( 'fs_sk_upd' === $col ) {
		$t = (int) get_post_meta( $post_id, '_fs_sk_updated', true );
		echo $t ? esc_html( wp_date( 'd.m.Y H:i', $t ) ) : '—';
	}
}, 10, 2 );

/* -------------------------------------------------------------------------
 * 5. Ausgabe auf der Webseite
 * ---------------------------------------------------------------------- */
add_action( 'wp_enqueue_scripts', function () {
	wp_register_style( 'fs-sk-front', FS_SK_URL . 'assets/frontend.css', array(), FS_SK_VERSION );
	wp_register_script( 'fs-sk-front', FS_SK_URL . 'assets/frontend.js', array(), FS_SK_VERSION, true );
} );

function fs_sk_resolve_id( $atts ) {
	$id = isset( $atts['id'] ) ? (int) $atts['id'] : 0;
	if ( ! $id && ! empty( $atts['name'] ) ) {
		$p = get_page_by_path( sanitize_title( $atts['name'] ), OBJECT, FS_SK_CPT );
		$id = $p ? $p->ID : 0;
	}
	$p = $id ? get_post( $id ) : null;
	return ( $p && FS_SK_CPT === $p->post_type && 'publish' === $p->post_status ) ? $id : 0;
}

/* ---------- Aussehen (pro Karte) ---------- */
function fs_sk_style_defaults() {
	return array(
		'layout'    => 'aufklappbar',
		'font_head' => '',
		'font_text' => '',
		'font_head_custom' => '',
		'font_text_custom' => '',
		'size'      => 'normal',
		'caps'      => '',
		'title'     => '',
		'accent'    => '',
		'btn_bg'    => '',
		'btn_text'  => '',
		'veg'       => '',
		'chili'     => '',
	);
}

function fs_sk_get_style( $post_id ) {
	$s = get_post_meta( $post_id, '_fs_sk_style', true );
	return array_merge( fs_sk_style_defaults(), is_array( $s ) ? $s : array() );
}

function fs_sk_font_options() {
	return array(
		''            => 'Wie die Webseite',
		'e-primary'   => 'Elementor: Primär',
		'e-secondary' => 'Elementor: Sekundär',
		'e-text'      => 'Elementor: Text',
		'e-accent'    => 'Elementor: Akzent',
		'custom'      => 'Eigene Schrift …',
	);
}

function fs_sk_sanitize_style( $in ) {
	$d   = fs_sk_style_defaults();
	$in  = is_array( $in ) ? $in : array();
	$out = $d;
	$out['layout'] = in_array( $in['layout'] ?? '', array( 'aufklappbar', 'offen' ), true ) ? $in['layout'] : $d['layout'];
	$out['size']   = in_array( $in['size'] ?? '', array( 'klein', 'normal', 'gross' ), true ) ? $in['size'] : 'normal';
	$out['caps']   = in_array( $in['caps'] ?? '', array( '', 'head', 'all' ), true ) ? $in['caps'] : '';
	foreach ( array( 'font_head', 'font_text' ) as $k ) {
		$out[ $k ] = array_key_exists( $in[ $k ] ?? '', fs_sk_font_options() ) ? $in[ $k ] : '';
		$out[ $k . '_custom' ] = mb_substr( preg_replace( '/[^\p{L}\p{N} ,\'"\-]/u', '', (string) ( $in[ $k . '_custom' ] ?? '' ) ), 0, 120 );
	}
	foreach ( array( 'title', 'accent', 'btn_bg', 'btn_text', 'veg', 'chili' ) as $k ) {
		$c         = sanitize_hex_color( (string) ( $in[ $k ] ?? '' ) );
		$out[ $k ] = $c ? $c : '';
	}
	return $out;
}

/** CSS-Variablen für das Aussehen einer Karte. */
function fs_sk_style_css( $st ) {
	$vars  = array();
	$fonts = array(
		'e-primary'   => 'var(--e-global-typography-primary-font-family, inherit)',
		'e-secondary' => 'var(--e-global-typography-secondary-font-family, inherit)',
		'e-text'      => 'var(--e-global-typography-text-font-family, inherit)',
		'e-accent'    => 'var(--e-global-typography-accent-font-family, inherit)',
	);
	foreach ( array( 'font_head' => '--fs-sk-font-head', 'font_text' => '--fs-sk-font-text' ) as $k => $var ) {
		if ( 'custom' === $st[ $k ] && '' !== $st[ $k . '_custom' ] ) {
			$vars[] = $var . ':' . $st[ $k . '_custom' ];
		} elseif ( isset( $fonts[ $st[ $k ] ] ) ) {
			$vars[] = $var . ':' . $fonts[ $st[ $k ] ];
		}
	}
	$sizes = array( 'klein' => '.94', 'gross' => '1.08' );
	if ( isset( $sizes[ $st['size'] ] ) ) {
		$vars[] = '--fs-sk-scale:' . $sizes[ $st['size'] ];
	}
	$map = array( 'title' => '--fs-sk-title', 'accent' => '--fs-sk-accent', 'btn_bg' => '--fs-sk-btn-bg', 'btn_text' => '--fs-sk-btn-color', 'veg' => '--fs-sk-veg', 'chili' => '--fs-sk-chili' );
	foreach ( $map as $k => $var ) {
		if ( '' !== $st[ $k ] ) {
			$vars[] = $var . ':' . $st[ $k ];
		}
	}
	return implode( ';', $vars );
}

/* ---------- Allergene / Zusatzstoffe ---------- */

/** Liest aus den Hinweisen („{A}Glutenhaltiges Getreide, {B}Krebstiere …“) die Codes und ihre Bedeutung. */
function fs_sk_parse_codes( $notes ) {
	$codes  = array();
	$groups = array();
	foreach ( (array) $notes as $ni => $note ) {
		if ( ! preg_match_all( '/\{([^{}]{1,6})\}\s*([^{]+)/u', $note, $m, PREG_SET_ORDER ) || count( $m ) < 2 ) {
			continue;
		}
		$label   = trim( preg_replace( '/\{.*$/us', '', $note ) );
		$label   = trim( preg_replace( '/^hinweis\s*/iu', '', rtrim( $label, ': ' ) ) );
		$entries = array();
		foreach ( $m as $x ) {
			$code  = trim( $x[1] );
			$full  = trim( preg_replace( '/[\s,;.]+$/u', '', trim( $x[2] ) ) );
			$short = preg_split( '/\s*\(|,\s|\s+und\s+daraus|\s+und\s+-\p{L}*|\s+d\.\s*h\./u', $full )[0];
			$short = trim( $short, " ,;:" );
			$codes[ $code ] = array( 'short' => $short ? $short : $full, 'full' => $full );
			$entries[ $code ] = $full;
		}
		$groups[ $ni ] = array( 'label' => $label ? $label : 'Hinweise', 'entries' => $entries );
	}
	return array( 'codes' => $codes, 'groups' => $groups );
}

/** Hochgestellte Codes als antippbarer Hinweis. */
function fs_sk_sup( $raw ) {
	$raw   = trim( (string) $raw );
	$codes = $GLOBALS['fs_sk_codes'] ?? array();
	if ( '' === $raw ) {
		return '';
	}
	$parts = array_filter( array_map( 'trim', preg_split( '/\s*,\s*/', $raw ) ), 'strlen' );
	// „DE“ ohne Komma → D und E, wenn beide bekannt sind
	$split = array();
	foreach ( $parts as $p ) {
		if ( ! isset( $codes[ $p ] ) && mb_strlen( $p ) > 1 && preg_match( '/^[A-Z]+$/', $p ) ) {
			$letters = str_split( $p );
			if ( count( array_filter( $letters, function ( $l ) use ( $codes ) { return isset( $codes[ $l ]); } ) ) === count( $letters ) ) {
				$split = array_merge( $split, $letters );
				continue;
			}
		}
		$split[] = $p;
	}
	$tips = array();
	foreach ( $split as $p ) {
		if ( isset( $codes[ $p ] ) ) {
			$tips[] = '<span class="fs-sk__tip-row"><b>' . esc_html( $p ) . '</b> ' . esc_html( $codes[ $p ]['short'] ) . '</span>';
		}
	}
	$label = esc_html( implode( ',', $split ) );
	if ( ! $tips ) {
		return '<sup class="fs-sk__sup">' . $label . '</sup>';
	}
	$aria = 'Allergene und Zusatzstoffe: ' . implode( ', ', array_map( function ( $p ) use ( $codes ) {
		return isset( $codes[ $p ] ) ? $codes[ $p ]['short'] : $p;
	}, $split ) );
	return '<sup class="fs-sk__sup fs-sk__sup--info"><button type="button" class="fs-sk__code" aria-expanded="false" aria-label="' . esc_attr( $aria ) . '">' . $label . '</button><span class="fs-sk__tip" role="tooltip">' . implode( '', $tips ) . '</span></sup>';
}

/** Text sicher ausgeben; {…} wird hochgestellt (Zusatzstoffe/Allergene). */
function fs_sk_inline( $text ) {
	$parts = preg_split( '/\{([^{}]{1,40})\}/u', (string) $text, -1, PREG_SPLIT_DELIM_CAPTURE );
	$out   = '';
	foreach ( $parts as $i => $p ) {
		$out .= ( $i % 2 ) ? fs_sk_sup( $p ) : esc_html( $p );
	}
	return $out;
}

/** Text ohne {…}-Markierungen (für Schema.org). */
function fs_sk_plain( $text ) {
	return trim( preg_replace( '/\s*\{[^{}]*\}/u', '', (string) $text ) );
}

/** Symbole: vegetarisch/vegan (Blatt) und Schärfe (Chili). */
function fs_sk_icons( $item ) {
	$labels = array( 1 => 'leicht scharf', 2 => 'mittelscharf', 3 => 'scharf' );
	$out    = '';
	if ( ! empty( $item['veg'] ) ) {
		$n    = 'vegan' === $item['veg'] ? 2 : 1;
		$out .= '<span class="fs-sk__ic-group fs-sk__ic-group--veg" role="img" aria-label="' . esc_attr( $item['veg'] ) . '" title="' . esc_attr( $item['veg'] ) . '">' . str_repeat( '<span class="fs-sk__ic fs-sk__ic--leaf" aria-hidden="true"></span>', $n ) . '</span>';
	}
	if ( ! empty( $item['spice'] ) ) {
		$n    = (int) $item['spice'];
		$out .= '<span class="fs-sk__ic-group fs-sk__ic-group--chili" role="img" aria-label="' . esc_attr( $labels[ $n ] ) . '" title="' . esc_attr( $labels[ $n ] ) . '">' . str_repeat( '<span class="fs-sk__ic fs-sk__ic--chili" aria-hidden="true"></span>', $n ) . '</span>';
	}
	return $out ? '<span class="fs-sk__icons">' . $out . '</span>' : '';
}

/** Zweisprachig ausgeben: Deutsch sichtbar, Englisch per Flagge umschaltbar. */
function fs_sk_dual( $de_html, $en_html, $tag = 'span', $class = '' ) {
	$c = $class ? $class . ' ' : '';
	if ( '' === (string) $en_html ) {
		return 'span' === $tag && ! $class ? $de_html : sprintf( '<%1$s class="%2$s">%3$s</%1$s>', $tag, esc_attr( trim( $c ) ), $de_html );
	}
	return sprintf( '<%1$s class="%2$sfs-sk__l1">%3$s</%1$s><%1$s class="%2$sfs-sk__l2" lang="en">%4$s</%1$s>', $tag, esc_attr( $c ), $de_html, $en_html );
}

/** Hat die Karte eine zweite Sprache? */
function fs_sk_has_lang2( $data ) {
	if ( ! empty( $data['lang2'] ) ) {
		return true;
	}
	foreach ( $data['sections'] as $s ) {
		if ( ! empty( $s['title2'] ) ) {
			return true;
		}
		foreach ( $s['items'] as $it ) {
			if ( ! empty( $it['name2'] ) || ! empty( $it['desc2'] ) ) {
				return true;
			}
		}
	}
	return false;
}

function fs_sk_flag( $lang ) {
	if ( 'en' === $lang ) {
		return '<svg class="fs-sk__flag" viewBox="0 0 60 30" aria-hidden="true"><clipPath id="fsuk"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="fsuk2"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#fsuk)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#fsuk2)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>';
	}
	return '<svg class="fs-sk__flag" viewBox="0 0 5 3" aria-hidden="true"><path d="M0 0h5v3H0z"/><path d="M0 1h5v2H0z" fill="#D00"/><path d="M0 2h5v1H0z" fill="#FFCE00"/></svg>';
}

/** Auswahl-Option wie „a Hühnerfleisch“ (Buchstabe statt Nummer). */
function fs_sk_is_option( $item ) {
	return isset( $item['nr'] ) && preg_match( '/^[a-h]$/', $item['nr'] );
}

/** Zeichenerklärung für die verwendeten Symbole. */
function fs_sk_legend( $used_icons ) {
	if ( ! $used_icons ) {
		return '';
	}
	$legend = array(
		'vegetarisch' => array( 'vegetarisch', array( 'veg' => 'vegetarisch' ), 'vegetarian' ),
		'vegan'       => array( 'vegan', array( 'veg' => 'vegan' ), 'vegan' ),
		'spice1'      => array( 'leicht scharf', array( 'spice' => 1 ), 'mildly spicy' ),
		'spice2'      => array( 'mittelscharf', array( 'spice' => 2 ), 'medium spicy' ),
		'spice3'      => array( 'scharf', array( 'spice' => 3 ), 'hot' ),
	);
	$out = '<ul class="fs-sk__legend" aria-label="Zeichenerklärung">';
	foreach ( $legend as $key => $l ) {
		if ( isset( $used_icons[ $key ] ) ) {
			$out .= '<li>' . fs_sk_icons( $l[1] ) . ' ' . ( $GLOBALS['fs_sk_dual'] ?? false ? fs_sk_dual( esc_html( $l[0] ), esc_html( $l[2] ) ) : esc_html( $l[0] ) ) . '</li>';
		}
	}
	return $out . '</ul>';
}

function fs_sk_price( $price, $currency, $mode = 'einheitlich' ) {
	$price = trim( (string) $price );
	if ( '' === $price ) {
		return '';
	}
	// 3,9 → 3,90 · 13 → 13,00 (einheitlich mit zwei Nachkommastellen)
	if ( 'original' !== $mode && preg_match( '/^(\d{1,4})(?:[.,](\d{1,2}))?$/', $price, $m ) ) {
		$price = $m[1] . ',' . str_pad( isset( $m[2] ) ? $m[2] : '', 2, '0' );
	}
	if ( '' !== $currency && false === mb_strpos( $price, $currency ) && preg_match( '/\d/', $price ) ) {
		$price .= "\u{00a0}" . $currency;
	}
	return $price;
}

function fs_sk_download_button( $post_id, $text, $is_html = false ) {
	$url = fs_sk_pdf_url( $post_id );
	if ( ! $url ) {
		return '';
	}
	return sprintf(
		'<a class="fs-sk__btn" href="%s" target="_blank" rel="noopener"><span class="fs-sk__btn-icon" aria-hidden="true"></span>%s</a>',
		esc_url( $url ),
		$is_html ? $text : esc_html( $text )
	);
}

/** Überschrift mit Preis („MITTAGSMENÜ 14,90 € p.P.“) → Preis getrennt ausgeben. */
function fs_sk_title_html( $title ) {
	if ( preg_match( '/^(.*?\S)\s+((?:ab\s+)?\d{1,3}[.,]\d{1,2}\s*(?:€|EUR|Euro).*)$/iu', $title, $m ) ) {
		return esc_html( $m[1] ) . ' <span class="fs-sk__title-price">' . esc_html( $m[2] ) . '</span>';
	}
	return esc_html( $title );
}

add_shortcode( 'speisekarte_pdf', function ( $atts ) {
	$atts = shortcode_atts( array( 'id' => 0, 'name' => '', 'text' => 'Speisekarte als PDF' ), $atts, 'speisekarte_pdf' );
	$id   = fs_sk_resolve_id( $atts );
	if ( ! $id ) {
		return '';
	}
	wp_enqueue_style( 'fs-sk-front' );
	return '<div class="fs-sk fs-sk--btn-only" style="' . esc_attr( fs_sk_style_css( fs_sk_get_style( $id ) ) ) . '">' . fs_sk_download_button( $id, $atts['text'] ) . '</div>';
} );

add_shortcode( 'speisekarte', function ( $atts ) {
	$atts = shortcode_atts( array(
		'id'           => 0,
		'name'         => '',
		'download'     => 'oben',
		'button'       => '',
		'navigation'   => 'nein',
		'nummern'      => 'ja',
		'zusatzstoffe' => 'ja',
		'waehrung'     => '€',
		'schema'       => 'ja',
		'ueberschrift' => 'h2',
		'preise'       => 'einheitlich',
		'legende'      => 'oben',
		'darstellung'  => '',
		'sprache'      => '',
	), $atts, 'speisekarte' );
	$pmode = 'original' === $atts['preise'] ? 'original' : 'einheitlich';

	$id = fs_sk_resolve_id( $atts );
	if ( ! $id ) {
		return current_user_can( 'edit_posts' ) ? '<p><em>Speisekarte nicht gefunden – bitte die ID im Shortcode prüfen.</em></p>' : '';
	}
	wp_enqueue_style( 'fs-sk-front' );
	wp_enqueue_script( 'fs-sk-front' );

	$data   = fs_sk_get_data( $id );
	$style  = fs_sk_get_style( $id );
	$layout = in_array( $atts['darstellung'], array( 'aufklappbar', 'offen' ), true ) ? $atts['darstellung'] : $style['layout'];
	$cur    = (string) $atts['waehrung'];
	$h      = in_array( $atts['ueberschrift'], array( 'h2', 'h3', 'h4' ), true ) ? $atts['ueberschrift'] : 'h2';
	$hi     = 'h2' === $h ? 'h3' : ( 'h3' === $h ? 'h4' : 'h5' );
	$nr_on  = 'aus' !== $atts['nummern'];
	$sup_on = 'aus' !== $atts['zusatzstoffe'];
	$btn    = $atts['button'] ? $atts['button'] : 'Speisekarte als PDF';
	$title  = get_the_title( $id );

	$parsed                  = fs_sk_parse_codes( $data['notes'] );
	$GLOBALS['fs_sk_codes'] = $parsed['codes'];

	// Welche Symbole kommen vor? (für die Zeichenerklärung)
	$used_icons = array();
	foreach ( $data['sections'] as $s ) {
		foreach ( $s['items'] as $it ) {
			if ( ! empty( $it['veg'] ) ) {
				$used_icons[ $it['veg'] ] = true;
			}
			if ( ! empty( $it['spice'] ) ) {
				$used_icons[ 'spice' . (int) $it['spice'] ] = true;
			}
		}
	}
	$legend_pos = in_array( $atts['legende'], array( 'oben', 'unten', 'aus' ), true ) ? $atts['legende'] : 'oben';
	$dual       = 'aus' !== ( $atts['sprache'] ?? '' ) && fs_sk_has_lang2( $data );
	$GLOBALS['fs_sk_dual'] = $dual;
	$d2         = function ( $de, $en ) use ( $dual ) {
		return $dual ? fs_sk_dual( $de, $en ) : $de;
	};
	$accordion  = 'aufklappbar' === $layout;

	ob_start();
	$caps_class = ! empty( $style['caps'] ) ? ' fs-sk--caps-' . $style['caps'] : '';
	printf( '<div class="fs-sk fs-sk--%s%s" id="speisekarte-%d" style="%s">', esc_attr( $layout ), esc_attr( $caps_class ), (int) $id, esc_attr( fs_sk_style_css( $style ) ) );

	// Kopfbereich: Download, Zeichenerklärung, Alle öffnen
	$btn_html = ( $dual && ! $atts['button'] ) ? fs_sk_dual( 'Speisekarte als PDF', 'Menu as PDF' ) : esc_html( $btn );
	$top  = 'oben' === $atts['download'] ? fs_sk_download_button( $id, $btn_html, true ) : '';
	$top .= 'oben' === $legend_pos ? fs_sk_legend( $used_icons ) : '';
	if ( $top ) {
		echo '<div class="fs-sk__top">' . $top . '</div>'; // phpcs:ignore -- bereits escaped
	}
	$bar = '';
	if ( $dual ) {
		$bar .= '<button type="button" class="fs-sk__lang" aria-pressed="false" data-de="Deutsch" data-en="English">'
			. '<span class="fs-sk__l1">' . fs_sk_flag( 'en' ) . ' English</span><span class="fs-sk__l2" lang="de">' . fs_sk_flag( 'de' ) . ' Deutsch</span></button>';
	}
	if ( $accordion && count( $data['sections'] ) > 1 ) {
		$bar .= '<button type="button" class="fs-sk__toggle" data-open="Alle Bereiche öffnen" data-close="Alle Bereiche schließen" data-open-en="Open all sections" data-close-en="Close all sections">Alle Bereiche öffnen</button>';
	}
	if ( $bar ) {
		echo '<p class="fs-sk__toggle-all">' . $bar . '</p>'; // phpcs:ignore -- bereits escaped
	}

	if ( 'ja' === $atts['navigation'] && count( $data['sections'] ) > 1 ) {
		echo '<nav class="fs-sk__nav" aria-label="Bereiche der Speisekarte"><ul>';
		foreach ( $data['sections'] as $n => $s ) {
			if ( '' !== $s['title'] ) {
				printf( '<li><a href="#fs-sk-%d-%d">%s</a></li>', (int) $id, (int) $n, esc_html( fs_sk_plain( $s['title'] ) ) );
			}
		}
		echo '</ul></nav>';
	}

	foreach ( $data['sections'] as $n => $s ) {
		$has_title = '' !== $s['title'];
		$main      = array();
		foreach ( $s['items'] as $ci ) {
			if ( ! empty( $ci['extra'] ) ) {
				break; // Beilagen/Extras nicht mitzählen
			}
			$main[] = $ci;
		}
		$count     = count( array_filter( $main, function ( $i ) { return 'sub' !== ( $i['type'] ?? '' ) && ! fs_sk_is_option( $i ); } ) );
		if ( $accordion && $has_title ) {
			printf( '<details class="fs-sk__section" id="fs-sk-%d-%d">', (int) $id, (int) $n );
			printf(
				'<summary class="fs-sk__summary"><%1$s class="fs-sk__title">%2$s</%1$s><span class="fs-sk__count">%3$s</span><span class="fs-sk__chev" aria-hidden="true"></span></summary>',
				$h, // phpcs:ignore
				$d2( fs_sk_title_html( $s['title'] ), ! empty( $s['title2'] ) ? fs_sk_title_html( $s['title2'] ) : '' ), // phpcs:ignore
				$count ? $d2( esc_html( $count . ( 1 === $count ? ' Eintrag' : ' Einträge' ) ), esc_html( $count . ( 1 === $count ? ' item' : ' items' ) ) ) : '' // phpcs:ignore
			);
		} else {
			printf( '<section class="fs-sk__section" id="fs-sk-%d-%d">', (int) $id, (int) $n );
			if ( $has_title ) {
				printf( '<%1$s class="fs-sk__title">%2$s</%1$s>', $h, $d2( fs_sk_title_html( $s['title'] ), ! empty( $s['title2'] ) ? fs_sk_title_html( $s['title2'] ) : '' ) ); // phpcs:ignore
			}
		}
		echo '<div class="fs-sk__body">';
		if ( '' !== $s['note'] ) {
			echo $dual ? fs_sk_dual( fs_sk_inline( $s['note'] ), ! empty( $s['note2'] ) ? fs_sk_inline( $s['note2'] ) : '', 'p', 'fs-sk__note' ) : '<p class="fs-sk__note">' . fs_sk_inline( $s['note'] ) . '</p>'; // phpcs:ignore
		}
		if ( $s['items'] ) {
			echo '<ul class="fs-sk__items">';
			foreach ( $s['items'] as $k => $it ) {
				if ( 'sub' === ( $it['type'] ?? '' ) ) {
					$next   = $s['items'][ $k + 1 ] ?? null;
					$is_opt = $next && 'sub' !== ( $next['type'] ?? '' ) && fs_sk_is_option( $next );
					echo '<li class="fs-sk__sub' . ( $is_opt ? ' fs-sk__sub--opt' : '' ) . ( ! empty( $it['extra'] ) ? ' fs-sk__sub--extra' : '' ) . '">' . $d2( fs_sk_inline( $it['name'] ), ! empty( $it['name2'] ) ? fs_sk_inline( $it['name2'] ) : '' ) . '</li>'; // phpcs:ignore
					continue;
				}
				$vars     = $it['variants'];
				$has_size = (bool) array_filter( $vars, function ( $v ) { return '' !== $v['size']; } );
				echo '<li class="fs-sk__item' . ( fs_sk_is_option( $it ) ? ' fs-sk__item--option' : '' ) . '">';
				echo '<div class="fs-sk__head">';
				if ( $nr_on && '' !== $it['nr'] ) {
					echo '<span class="fs-sk__nr">' . esc_html( $it['nr'] ) . '</span>';
				}
				$fmt       = function ( $t ) use ( $sup_on ) {
					return $sup_on ? fs_sk_inline( $t ) : esc_html( fs_sk_plain( $t ) );
				};
				$name_html = $d2( $fmt( $it['name'] ), ! empty( $it['name2'] ) ? $fmt( $it['name2'] ) : '' );
				printf(
					'<%1$s class="fs-sk__name">%2$s%3$s%4$s%5$s</%1$s>',
					$hi, // phpcs:ignore
					$name_html, // phpcs:ignore
					( $sup_on && '' !== $it['sup'] ) ? fs_sk_sup( $it['sup'] ) : '', // phpcs:ignore
					fs_sk_icons( $it ), // phpcs:ignore
					! empty( $it['badge'] ) ? ' <span class="fs-sk__badge">' . $d2( esc_html( $it['badge'] ), 'Neu' === $it['badge'] ? 'New' : '' ) . '</span>' : '' // phpcs:ignore
				);
				// erste Menge/Preis in derselben Zeile wie der Name
				if ( $vars ) {
					if ( $has_size ) {
						echo '<span class="fs-sk__size">' . esc_html( $vars[0]['size'] ) . '</span>';
					}
					echo '<span class="fs-sk__price">' . esc_html( fs_sk_price( $vars[0]['price'], $cur, $pmode ) ) . '</span>';
				}
				echo '</div>';
				if ( count( $vars ) > 1 ) {
					echo '<ul class="fs-sk__variants">';
					foreach ( array_slice( $vars, 1 ) as $v ) {
						printf(
							'<li><span class="fs-sk__size">%s</span><span class="fs-sk__price">%s</span></li>',
							esc_html( $v['size'] ),
							esc_html( fs_sk_price( $v['price'], $cur, $pmode ) )
						);
					}
					echo '</ul>';
				}
				$de2 = (string) ( $it['desc2'] ?? '' );
				if ( $dual ) {
					if ( '' !== $it['desc'] || '' !== $de2 ) {
						echo fs_sk_dual( '' !== $it['desc'] ? $fmt( $it['desc'] ) : '', '' !== $de2 ? $fmt( $de2 ) : '', 'p', 'fs-sk__desc' ); // phpcs:ignore
					}
				} elseif ( '' !== $it['desc'] ) {
					echo '<p class="fs-sk__desc">' . $fmt( $it['desc'] ) . '</p>'; // phpcs:ignore
				}
				echo '</li>';
			}
			echo '</ul>';
		}
		echo '</div>';
		echo ( $accordion && $has_title ) ? '</details>' : '</section>';
	}

	if ( 'unten' === $legend_pos ) {
		echo fs_sk_legend( $used_icons ); // phpcs:ignore
	}

	// Hinweise: Allergen-/Zusatzstoff-Listen übersichtlich, Rest als Text
	if ( $data['notes'] ) {
		echo '<div class="fs-sk__notes">';
		foreach ( $data['notes'] as $ni => $note ) {
			if ( isset( $parsed['groups'][ $ni ] ) ) {
				$g = $parsed['groups'][ $ni ];
				echo '<div class="fs-sk__codelist"><p class="fs-sk__codelist-title">' . esc_html( $g['label'] ) . '</p><dl>';
				foreach ( $g['entries'] as $code => $txt ) {
					echo '<div><dt>' . esc_html( $code ) . '</dt><dd>' . esc_html( $txt ) . '</dd></div>';
				}
				echo '</dl></div>';
			} else {
				echo '<p>' . fs_sk_inline( $note ) . '</p>'; // phpcs:ignore
			}
		}
		echo '</div>';
	}

	if ( 'unten' === $atts['download'] ) {
		echo '<div class="fs-sk__top fs-sk__top--bottom">' . fs_sk_download_button( $id, $btn_html, true ) . '</div>'; // phpcs:ignore
	}
	echo '</div>';

	if ( 'ja' === $atts['schema'] ) {
		echo fs_sk_schema( $id, $title, $data ); // phpcs:ignore
	}
	return ob_get_clean();
} );

/** Schema.org „Menu“ – hilft Google, Gerichte und Preise zu verstehen. */
function fs_sk_schema( $id, $title, $data ) {
	$sections = array();
	foreach ( $data['sections'] as $s ) {
		$items = array();
		foreach ( $s['items'] as $it ) {
			if ( 'sub' === ( $it['type'] ?? '' ) || '' === $it['name'] ) {
				continue;
			}
			$mi = array( '@type' => 'MenuItem', 'name' => fs_sk_plain( $it['name'] ) );
			if ( '' !== $it['desc'] ) {
				$mi['description'] = fs_sk_plain( $it['desc'] );
			}
			if ( ! empty( $it['veg'] ) ) {
				$mi['suitableForDiet'] = 'vegan' === $it['veg'] ? 'https://schema.org/VeganDiet' : 'https://schema.org/VegetarianDiet';
			}
			$offers = array();
			foreach ( $it['variants'] as $v ) {
				$p = str_replace( array( '€', 'EUR', ' ', "\u{00a0}" ), '', $v['price'] );
				$p = preg_replace( '/,[-–]+$/', ',00', $p );
				if ( preg_match( '/^\d{1,4}([.,]\d{1,2})?$/', $p ) ) {
					$o = array( '@type' => 'Offer', 'price' => number_format( (float) str_replace( ',', '.', $p ), 2, '.', '' ), 'priceCurrency' => 'EUR' );
					if ( '' !== $v['size'] ) {
						$o['name'] = $v['size'];
					}
					$offers[] = $o;
				}
			}
			if ( $offers ) {
				$mi['offers'] = count( $offers ) === 1 ? $offers[0] : $offers;
			}
			$items[] = $mi;
		}
		if ( $items ) {
			$sec = array( '@type' => 'MenuSection', 'hasMenuItem' => $items );
			if ( '' !== $s['title'] ) {
				$sec['name'] = $s['title'];
			}
			$sections[] = $sec;
		}
	}
	if ( ! $sections ) {
		return '';
	}
	$schema = array(
		'@context'       => 'https://schema.org',
		'@type'          => 'Menu',
		'name'           => $title,
		'hasMenuSection' => $sections,
	);
	$pdf = fs_sk_pdf_url( $id, false );
	if ( $pdf ) {
		$schema['url'] = $pdf;
	}
	return '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG ) . '</script>';
}
