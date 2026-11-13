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
		$items = array();
		foreach ( $s['items'] as $it ) {
			if ( 'sub' === ( $it['type'] ?? '' ) || '' === trim( (string) ( $it['name'] ?? '' ) ) ) {
				continue;
			}
			// Preise (Google verlangt mindestens einen)
			$prices = array();
			foreach ( (array) ( $it['variants'] ?? array() ) as $v ) {
				$n = fs_sk_price_number( $v['price'] ?? '' );
				if ( null !== $n ) {
					$prices[] = array( 'size' => trim( (string) ( $v['size'] ?? '' ) ), 'num' => $n );
				}
			}
			if ( ! $prices ) {
				continue;
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
			// Mehrere Größen → Varianten bei Google
			if ( count( $prices ) > 1 ) {
				$mi['options'] = array();
				foreach ( $prices as $i => $p ) {
					$label           = '' !== $p['size'] ? $p['size'] : 'Variante ' . ( $i + 1 );
					$mi['options'][] = array(
						'labels'     => array( array( 'displayName' => mb_substr( $label, 0, 140 ), 'languageCode' => 'de' ) ),
						'attributes' => array( 'price' => fs_sk_google_money( $p['num'] ) ),
					);
				}
			} elseif ( '' !== $prices[0]['size'] && isset( $mi['labels'][0] ) ) {
				// Eine Größe (z. B. 0,5 l) → an die Beschreibung hängen
				$d = $mi['labels'][0]['description'] ?? '';
				$mi['labels'][0]['description'] = trim( $prices[0]['size'] . ( '' !== $d ? ' · ' . $d : '' ) );
			}
			$items[] = $mi;
			$count++;
		}
		if ( $items ) {
			$title      = '' !== trim( (string) $s['title'] ) ? $s['title'] : get_the_title( $post );
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
