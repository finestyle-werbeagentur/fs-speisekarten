<?php
/**
 * Ausgabe der Karten im Format von Google Business Profile (foodMenus).
 *
 * GET /wp-json/fs-speisekarten/v1/google        → alle Karten der Website
 * GET /wp-json/fs-speisekarten/v1/google/{id}   → eine Karte
 *
 * Das Kundenpanel holt sich hier den fertigen Inhalt und schickt ihn
 * per updateFoodMenus an das Google-Profil des Kunden.
 * Ausgegeben werden nur veröffentlichte Karten – also nichts, was nicht
 * ohnehin auf der Website steht.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Preis aus dem Kartentext als Zahl, z. B. "12,50 €" → 12.5. */
function fs_sk_price_number( $price ) {
	$p = str_replace( array( '€', 'EUR', 'Euro', ' ', "\u{00a0}" ), '', (string) $price );
	$p = preg_replace( '/^(ab|je|nur)\.?/iu', '', $p );
	$p = preg_replace( '/,[-–]+$/u', ',00', $p );
	if ( preg_match( '/^\d{1,4}([.,]\d{1,2})?$/', $p ) ) {
		return (float) str_replace( ',', '.', $p );
	}
	return null;
}

/** Zahl → Google "Money". */
function fs_sk_google_money( $num ) {
	$cents = (int) round( $num * 100 );
	$money = array(
		'currencyCode' => 'EUR',
		'units'        => (string) intdiv( $cents, 100 ),
	);
	if ( $cents % 100 ) {
		$money['nanos'] = ( $cents % 100 ) * 10000000;
	}
	return $money;
}

/** Bezeichnung in Deutsch und – falls vorhanden – Englisch. */
function fs_sk_google_labels( $name, $desc = '', $name2 = '', $desc2 = '' ) {
	$cut = function ( $v, $max ) {
		$v = trim( preg_replace( '/\s+/u', ' ', fs_sk_plain( wp_strip_all_tags( (string) $v ) ) ) );
		return mb_strlen( $v ) > $max ? rtrim( mb_substr( $v, 0, $max - 1 ) ) . '…' : $v;
	};
	$labels = array();
	$de     = array( 'displayName' => $cut( $name, 140 ), 'languageCode' => 'de' );
	if ( '' !== trim( (string) $desc ) ) {
		$de['description'] = $cut( $desc, 1000 );
	}
	$labels[] = $de;
	if ( '' !== trim( (string) $name2 ) || '' !== trim( (string) $desc2 ) ) {
		$en = array( 'displayName' => $cut( '' !== trim( (string) $name2 ) ? $name2 : $name, 140 ), 'languageCode' => 'en' );
		if ( '' !== trim( (string) $desc2 ) ) {
			$en['description'] = $cut( $desc2, 1000 );
		}
		$labels[] = $en;
	}
	return $labels;
}


/** „MITTAGSMENÜ 14,90 € p.P.“ → array( 'Mittagsmenü', 14.9, '€ p.P.' ) */
function fs_sk_google_split_title( $title ) {
	$title = trim( (string) $title );
	if ( preg_match( '/^(.*?\S)\s+(?:ab\s+)?(\d{1,3}[.,]\d{1,2})\s*(?:€|EUR|Euro)\s*(.*)$/iu', $title, $m ) ) {
		return array( $m[1], (float) str_replace( ',', '.', $m[2] ), trim( $m[3] ) );
	}
	return array( $title, null, '' );
}

/** Preise eines Eintrags: array( array( 'size' => …, 'num' => … ), … ) */
function fs_sk_google_prices( $it ) {
	$prices = array();
	foreach ( (array) ( $it['variants'] ?? array() ) as $v ) {
		$n = fs_sk_price_number( $v['price'] ?? '' );
		if ( null !== $n ) {
			$prices[] = array( 'size' => trim( (string) ( $v['size'] ?? '' ) ), 'num' => $n );
		}
	}
	return $prices;
}

function fs_sk_google_option( $label, $num ) {
	return array(
		'labels'     => array( array( 'displayName' => mb_substr( fs_sk_plain( (string) $label ), 0, 140 ), 'languageCode' => 'de' ) ),
		'attributes' => array( 'price' => fs_sk_google_money( $num ) ),
	);
}

/** Ein Gericht im Google-Format. $choices: Auswahl (Name + Preis), die zu diesem Gericht gehört. */
function fs_sk_google_item( $it, $prices, $choices = array() ) {
	if ( $choices && ! $prices ) {
		$prices = array( array( 'size' => '', 'num' => min( wp_list_pluck( $choices, 'num' ) ) ) );
	}
	$attr = array( 'price' => fs_sk_google_money( $prices[0]['num'] ) );
	if ( 'vegan' === ( $it['veg'] ?? '' ) ) {
		$attr['dietaryRestriction'] = array( 'VEGAN' );
	} elseif ( 'vegetarisch' === ( $it['veg'] ?? '' ) ) {
		$attr['dietaryRestriction'] = array( 'VEGETARIAN' );
	}
	$spice = (int) ( $it['spice'] ?? 0 );
	if ( $spice > 0 ) {
		$attr['spiciness'] = array( 1 => 'MILD', 2 => 'MEDIUM', 3 => 'HOT' )[ min( 3, $spice ) ];
	}
	$mi = array(
		'labels'     => fs_sk_google_labels( $it['name'], $it['desc'] ?? '', $it['name2'] ?? '', $it['desc2'] ?? '' ),
		'attributes' => $attr,
	);
	$opts = array();
	if ( count( $prices ) > 1 ) { // mehrere Größen
		foreach ( $prices as $i => $p ) {
			$opts[] = fs_sk_google_option( '' !== $p['size'] ? $p['size'] : 'Variante ' . ( $i + 1 ), $p['num'] );
		}
	} elseif ( '' !== $prices[0]['size'] ) { // eine Größe (z. B. 0,5 l) → in die Beschreibung
		$d = $mi['labels'][0]['description'] ?? '';
		$mi['labels'][0]['description'] = trim( $prices[0]['size'] . ( '' !== $d ? ' · ' . $d : '' ) );
	}
	foreach ( $choices as $c ) { // „Dazu wahlweise“ / „Wähle dein Topping“
		$opts[] = fs_sk_google_option( $c['name'], $c['num'] );
	}
	if ( $opts ) {
		$mi['options'] = $opts;
	}
	return $mi;
}

/**
 * Einträge eines Bereichs so umbauen, wie Gäste die Karte lesen:
 * - a/b/c-Einträge nach einem Gericht („Dazu wahlweise: Huhn 6,00 …“) → Auswahl bei diesem Gericht
 * - Gerichte ohne Preis + spätere a/b/c-Liste („Wähle dein Topping“) → jedes Gericht mit dieser Auswahl
 * - Einträge ohne Preis vor Gerichten mit Preis („Wähle zuerst deine Nudeln“) → Auswahl bei diesen Gerichten
 * - Bereich mit Preis in der Überschrift („Mittagsmenü 14,90 €“) → ein Angebot mit Beschreibung
 */
function fs_sk_google_section_items( $s ) {
	$rows = array();
	foreach ( $s['items'] as $it ) {
		$name = trim( fs_sk_plain( (string) ( $it['name'] ?? '' ) ) );
		if ( '' === $name ) {
			continue;
		}
		if ( 'sub' === ( $it['type'] ?? '' ) ) {
			$rows[] = array( 'kind' => 'sub', 'name' => $name );
			continue;
		}
		$prices = fs_sk_google_prices( $it );
		$letter = (bool) preg_match( '/^[a-z]\.?$/i', trim( (string) ( $it['nr'] ?? '' ) ) );
		$rows[] = array( 'kind' => $letter && $prices ? 'choice' : ( $prices ? 'dish' : 'free' ), 'it' => $it, 'name' => $name, 'prices' => $prices );
	}

	// Bereich mit Preis in der Überschrift und ohne eigene Preise → ein Angebot
	list( $title, $tprice, $tunit ) = fs_sk_google_split_title( $s['title'] ?? '' );
	$has_priced = (bool) array_filter( $rows, function ( $r ) { return 'sub' !== $r['kind'] && 'free' !== $r['kind']; } );
	if ( null !== $tprice && ! $has_priced && $rows ) {
		$parts = array();
		foreach ( $rows as $r ) {
			$parts[] = $r['name'];
		}
		$desc = preg_replace( '/:\s*·\s*/u', ': ', implode( ' · ', $parts ) );
		if ( preg_match( '/^p\.?\s*P\.?$/iu', $tunit ) ) {
			$desc = 'Preis pro Person · ' . $desc;
		} elseif ( '' !== $tunit ) {
			$desc = $tunit . ' · ' . $desc;
		}
		$it = array( 'name' => $title, 'desc' => $desc, 'name2' => fs_sk_google_split_title( $s['title2'] ?? '' )[0] );
		return array( fs_sk_google_item( $it, array( array( 'size' => '', 'num' => $tprice ) ) ) );
	}

	$out       = array();
	$last_dish = false;
	$pending = array(); // Gerichte ohne Preis, die auf eine Auswahl warten
	$pre     = array(); // Auswahl ohne Preis vor Gerichten („Wähle zuerst deine Nudeln“)
	$n       = count( $rows );
	for ( $i = 0; $i < $n; $i++ ) {
		$r = $rows[ $i ];
		if ( 'sub' === $r['kind'] ) {
			continue;
		}
		if ( 'free' === $r['kind'] ) {
			$pending[] = $r;
			continue;
		}
		if ( 'choice' === $r['kind'] ) {
			// ganze a/b/c-Liste einsammeln
			$choices = array();
			for ( ; $i < $n && ( 'choice' === $rows[ $i ]['kind'] || 'sub' === $rows[ $i ]['kind'] ); $i++ ) {
				if ( 'choice' === $rows[ $i ]['kind'] ) {
					$choices[] = array( 'name' => $rows[ $i ]['name'], 'num' => $rows[ $i ]['prices'][0]['num'] );
				}
			}
			$i--;
			if ( $pending ) { // „Wähle dein Topping“ für alle Gerichte davor
				foreach ( $pending as $p ) {
					$out[] = fs_sk_google_item( $p['it'], array(), $choices );
				}
				$pending = array();
			} elseif ( $out && ! empty( $last_dish ) ) { // „Dazu wahlweise“ beim letzten Gericht
				$last = array_pop( $out );
				foreach ( $choices as $c ) {
					$last['options'][] = fs_sk_google_option( $c['name'], $c['num'] );
				}
				$out[] = $last;
			} else {
				foreach ( $choices as $c ) {
					$out[] = fs_sk_google_item( array( 'name' => $c['name'] ), array( array( 'size' => '', 'num' => $c['num'] ) ) );
				}
			}
			$last_dish = false;
			continue;
		}
		// Gericht mit Preis
		if ( $pending ) { // Auswahl ohne Preis davor („Wähle zuerst deine Nudeln“)
			$pre     = $pending;
			$pending = array();
		}
		$choices = array();
		foreach ( $pre as $p ) {
			$choices[] = array( 'name' => $p['name'], 'num' => $r['prices'][0]['num'] );
		}
		$out[]     = fs_sk_google_item( $r['it'], $r['prices'], count( $r['prices'] ) > 1 ? array() : $choices );
		$last_dish = true;
	}
	return $out;
}

/** Eine Karte → ein Google-"menu". Gibt null zurück, wenn nichts Brauchbares drin ist. */
function fs_sk_google_menu( $post_id ) {
	$post = get_post( $post_id );
	if ( ! $post || FS_SK_CPT !== $post->post_type ) {
		return null;
	}
	$data     = fs_sk_get_data( $post_id );
	$sections = array();
	$count    = 0;

	foreach ( $data['sections'] as $s ) {
		$items  = fs_sk_google_section_items( $s );
		$count += count( $items );
		if ( $items ) {
			$title      = '' !== trim( (string) $s['title'] ) ? fs_sk_google_split_title( $s['title'] )[0] : get_the_title( $post );
			$sections[] = array(
				'labels' => fs_sk_google_labels( $title, '', $s['title2'] ?? '' ),
				'items'  => $items,
			);
		}
	}
	if ( ! $sections ) {
		return null;
	}
	$title = get_the_title( $post );
	$en    = fs_sk_has_lang2( $data ) ? ( 'Speisekarte' === $title ? 'Menu' : $title ) : '';
	$menu = array(
		'labels'   => fs_sk_google_labels( $title, '', $en ),
		'sections' => $sections,
	);
	$pdf = fs_sk_pdf_url( $post_id, false );
	if ( $pdf ) {
		$menu['sourceUrl'] = $pdf;
	}
	return array(
		'meta' => array(
			'id'      => (int) $post_id,
			'title'   => $title,
			'items'   => $count,
			'updated' => (int) get_post_meta( $post_id, '_fs_sk_updated', true ),
		),
		'menu' => $menu,
	);
}

/** Alle Karten, die zu Google sollen. */
function fs_sk_google_ids() {
	return get_posts( array(
		'post_type'      => FS_SK_CPT,
		'post_status'    => 'publish',
		'posts_per_page' => 50,
		'orderby'        => array( 'menu_order' => 'ASC', 'date' => 'ASC' ),
		'fields'         => 'ids',
		'meta_query'     => array( // phpcs:ignore -- wenige Karten pro Website
			'relation' => 'OR',
			array( 'key' => '_fs_sk_google', 'compare' => 'NOT EXISTS' ),
			array( 'key' => '_fs_sk_google', 'value' => 'no', 'compare' => '!=' ),
		),
	) );
}

function fs_sk_google_response( $ids ) {
	$menus = array();
	$cards = array();
	foreach ( $ids as $id ) {
		$m = fs_sk_google_menu( $id );
		if ( $m ) {
			$menus[] = $m['menu'];
			$cards[] = $m['meta'];
		}
	}
	$updated = $cards ? max( wp_list_pluck( $cards, 'updated' ) ) : 0;
	return array(
		'site'      => home_url( '/' ),
		'version'   => FS_SK_VERSION,
		'cards'     => $cards,
		'updated'   => $updated,
		// Fingerabdruck: Das Panel sendet nur, wenn sich etwas geändert hat
		'hash'      => md5( wp_json_encode( $menus ) ),
		// Genau dieser Teil geht per PATCH …/locations/{id}/foodMenus an Google
		'foodMenus' => array( 'menus' => $menus ),
	);
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'fs-speisekarten/v1', '/google', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			return rest_ensure_response( fs_sk_google_response( fs_sk_google_ids() ) );
		},
	) );
	register_rest_route( 'fs-speisekarten/v1', '/google/(?P<id>\d+)', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function ( WP_REST_Request $r ) {
			$id = (int) $r['id'];
			if ( FS_SK_CPT !== get_post_type( $id ) || 'publish' !== get_post_status( $id ) ) {
				return new WP_Error( 'fs_sk_not_found', 'Karte nicht gefunden', array( 'status' => 404 ) );
			}
			return rest_ensure_response( fs_sk_google_response( array( $id ) ) );
		},
	) );
} );

/* -------------------------------------------------------------------------
 * Automatisch an Google: Nach dem Speichern gibt die Website dem Finestyle-
 * Kundenpanel Bescheid. Das Panel holt die Karte über die Adresse oben ab und
 * schickt sie an das zugeordnete Google-Profil. Die Zugangsdaten zu Google
 * liegen nur im Panel, nie auf der Website.
 * ---------------------------------------------------------------------- */
if ( ! defined( 'FS_SK_PANEL_PING' ) ) {
	define( 'FS_SK_PANEL_PING', 'https://panel.finestyle.eu/google.php?a=ping' );
}

/** Übertragung in ein paar Sekunden im Hintergrund anstoßen. */
function fs_sk_google_queue( $delay = 5 ) {
	if ( ! FS_SK_PANEL_PING ) {
		return;
	}
	if ( ! wp_next_scheduled( 'fs_sk_google_ping' ) ) {
		wp_schedule_single_event( time() + $delay, 'fs_sk_google_ping' );
	}
	update_option( 'fs_sk_google_status', array( 'st' => 'busy', 'msg' => 'Wird an Google übertragen …', 'at' => time() ), false );
}

add_action( 'fs_sk_google_ping', function () {
	$r = wp_remote_post( FS_SK_PANEL_PING, array(
		'timeout' => 60,
		'body'    => array( 'site' => home_url( '/' ) ),
	) );
	if ( is_wp_error( $r ) ) {
		$st = array( 'st' => 'err', 'msg' => 'Das Kundenpanel ist gerade nicht erreichbar.' );
	} else {
		$j  = json_decode( wp_remote_retrieve_body( $r ), true );
		$st = is_array( $j ) && isset( $j['st'] ) ? array( 'st' => sanitize_key( $j['st'] ), 'msg' => sanitize_text_field( (string) ( $j['msg'] ?? '' ) ) )
			: array( 'st' => 'err', 'msg' => 'Unerwartete Antwort vom Kundenpanel.' );
		if ( 'busy' === $st['st'] ) { // läuft gerade schon → gleich noch einmal
			wp_schedule_single_event( time() + 30, 'fs_sk_google_ping' );
		}
	}
	$st['at'] = time();
	update_option( 'fs_sk_google_status', $st, false );
} );

// Nach dem Speichern einer veröffentlichten Karte
add_action( 'save_post_' . FS_SK_CPT, function ( $post_id, $post ) {
	if ( wp_is_post_revision( $post_id ) || ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) ) {
		return;
	}
	if ( 'publish' === $post->post_status && isset( $_POST['fs_sk_nonce'] ) ) { // phpcs:ignore -- Nonce prüft der Speicher-Handler
		fs_sk_google_queue();
		if ( function_exists( 'spawn_cron' ) ) {
			spawn_cron();
		}
	}
}, 30, 2 );

/** Stand der letzten Übertragung (für die Seitenleiste) */
function fs_sk_google_status_html() {
	$st = get_option( 'fs_sk_google_status' );
	if ( ! is_array( $st ) || empty( $st['st'] ) ) {
		return '';
	}
	$icon = array( 'ok' => '✓', 'held' => '!', 'err' => '✕', 'wait' => '…', 'busy' => '…' );
	$when = ! empty( $st['at'] ) ? ' (' . wp_date( 'd.m.Y H:i', (int) $st['at'] ) . ')' : '';
	return '<p class="fs-small fs-google fs-google--' . esc_attr( $st['st'] ) . '"><strong>' . esc_html( $icon[ $st['st'] ] ?? '' ) . ' Google:</strong> '
		. esc_html( (string) ( $st['msg'] ?? '' ) ) . esc_html( $when ) . '</p>';
}
