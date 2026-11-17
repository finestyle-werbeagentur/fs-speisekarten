<?php
/**
 * Finestyle Updater
 *
 * Holt Updates für eigene Finestyle-Plugins vom Kundenpanel (panel.finestyle.eu/update.php).
 * Updates erscheinen ganz normal unter Dashboard → Aktualisierungen und in MainWP.
 *
 * Einbinden in der Haupt-Datei des Plugins:
 *   require_once __DIR__ . '/finestyle-updater.php';
 *   new Finestyle_Updater( __FILE__, 'ordnername-des-plugins' );
 *
 * Mehrere Finestyle-Plugins auf einer Website teilen sich die Klasse (class_exists-Prüfung).
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'Finestyle_Updater' ) ) {

	class Finestyle_Updater {

		const URL = 'https://panel.finestyle.eu/update.php';

		/** So lange wird die Antwort des Panels zwischengespeichert (im Backend). */
		const CACHE = HOUR_IN_SECONDS;

		private $file;
		private $slug;
		private $basename;
		private $version;
		private $cache_key;

		public function __construct( $file, $slug ) {
			$this->file      = $file;
			$this->slug      = $slug;
			$this->basename  = plugin_basename( $file );
			$this->cache_key = 'fsupd_' . md5( $slug );

			add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'beim_pruefen' ) );
			add_filter( 'site_transient_update_plugins', array( $this, 'beim_lesen' ) );
			add_filter( 'plugins_api', array( $this, 'details' ), 20, 3 );
			add_action( 'upgrader_process_complete', array( $this, 'cache_leeren' ), 10, 0 );
		}

		private function version() {
			if ( ! $this->version ) {
				$d             = get_file_data( $this->file, array( 'Version' => 'Version' ) );
				$this->version = $d['Version'];
			}
			return $this->version;
		}

		/**
		 * Antwort des Panels (zwischengespeichert).
		 *
		 * @param int $max_alter Sekunden, ab denen neu gefragt wird (0 = Cache benutzen, nie neu fragen).
		 */
		private function abrufen( $max_alter = self::CACHE ) {
			$c = get_site_transient( $this->cache_key );
			if ( is_array( $c ) && ( 0 === $max_alter || ( time() - (int) $c['zeit'] ) < $max_alter ) ) {
				return $c['daten'];
			}
			if ( 0 === $max_alter ) {
				return null;
			}
			$url = add_query_arg(
				array(
					'plugin' => $this->slug,
					'v'      => $this->version(),
					'site'   => home_url(),
				),
				self::URL
			);
			$r     = wp_remote_get( $url, array( 'timeout' => 8 ) );
			$daten = null;
			if ( ! is_wp_error( $r ) && 200 === (int) wp_remote_retrieve_response_code( $r ) ) {
				$j = json_decode( wp_remote_retrieve_body( $r ), true );
				if ( is_array( $j ) && ! empty( $j['version'] ) && ! empty( $j['download_url'] ) ) {
					$daten = $j;
				}
			}
			// Bei Fehler trotzdem merken, aber schon nach 15 Minuten neu versuchen.
			$zeit = $daten ? time() : time() - self::CACHE + 15 * MINUTE_IN_SECONDS;
			set_site_transient( $this->cache_key, array( 'zeit' => $zeit, 'daten' => $daten ), DAY_IN_SECONDS );
			return $daten;
		}

		/** Eintrag in die Update-Liste von WordPress schreiben. */
		private function eintragen( $t, $d ) {
			if ( ! $d ) {
				return $t;
			}
			if ( ! is_object( $t ) ) {
				$t = new stdClass();
			}
			$eintrag = (object) array(
				'id'           => $this->basename,
				'slug'         => $this->slug,
				'plugin'       => $this->basename,
				'new_version'  => $d['version'],
				'url'          => isset( $d['homepage'] ) ? $d['homepage'] : '',
				'package'      => $d['download_url'],
				'requires'     => isset( $d['requires'] ) ? $d['requires'] : '',
				'requires_php' => isset( $d['requires_php'] ) ? $d['requires_php'] : '',
				'icons'        => array(),
				'banners'      => array(),
			);
			if ( version_compare( $d['version'], $this->version(), '>' ) ) {
				$t->response                    = isset( $t->response ) ? (array) $t->response : array();
				$t->response[ $this->basename ] = $eintrag;
				if ( isset( $t->no_update[ $this->basename ] ) ) {
					unset( $t->no_update[ $this->basename ] );
				}
			} else {
				$eintrag->new_version            = $this->version();
				$eintrag->package                = '';
				$t->no_update                    = isset( $t->no_update ) ? (array) $t->no_update : array();
				$t->no_update[ $this->basename ] = $eintrag;
				if ( isset( $t->response[ $this->basename ] ) ) {
					unset( $t->response[ $this->basename ] );
				}
			}
			return $t;
		}

		/** WordPress prüft auf Updates (alle 12 Std. oder „Erneut prüfen“). */
		public function beim_pruefen( $t ) {
			$neu = is_admin() && isset( $_GET['force-check'] ); // phpcs:ignore WordPress.Security.NonceVerification
			return $this->eintragen( $t, $this->abrufen( $neu ? 1 : self::CACHE ) );
		}

		/** Jemand liest die Update-Liste (Dashboard, MainWP, Cron). */
		public function beim_lesen( $t ) {
			if ( ! is_object( $t ) ) {
				return $t; // WordPress hat noch gar nicht geprüft – dann nichts vorwegnehmen
			}
			if ( isset( $_POST['mainwpsignature'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
				$max = 10 * MINUTE_IN_SECONDS; // MainWP-Sync: fast frisch
			} elseif ( is_admin() || wp_doing_cron() ) {
				$max = self::CACHE;
			} else {
				$max = 0; // Website-Besucher: nie auf das Panel warten
			}
			return $this->eintragen( $t, $this->abrufen( $max ) );
		}

		/** Fenster „Details ansehen“. */
		public function details( $res, $action, $args ) {
			if ( 'plugin_information' !== $action || empty( $args->slug ) || $args->slug !== $this->slug ) {
				return $res;
			}
			$d = $this->abrufen();
			if ( ! $d ) {
				return $res;
			}
			return (object) array(
				'name'          => $d['name'],
				'slug'          => $this->slug,
				'version'       => $d['version'],
				'author'        => '<a href="https://finestyle.eu">Finestyle Werbeagentur</a>',
				'homepage'      => 'https://finestyle.eu',
				'requires'      => $d['requires'],
				'requires_php'  => $d['requires_php'],
				'last_updated'  => $d['last_updated'],
				'download_link' => $d['download_url'],
				'sections'      => array(
					'description' => esc_html( $d['description'] ),
					'changelog'   => nl2br( esc_html( $d['changelog'] ? $d['changelog'] : 'Version ' . $d['version'] ) ),
				),
			);
		}

		public function cache_leeren() {
			delete_site_transient( $this->cache_key );
		}
	}
}
