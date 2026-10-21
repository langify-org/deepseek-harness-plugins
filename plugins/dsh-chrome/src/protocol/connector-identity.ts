/**
 * The connector extension's identity.
 *
 * Chrome derives an extension id from the public key in its manifest, so an unpacked
 * connector gets the same id on every machine. The native host manifest allows only
 * this id to start the relay.
 *
 * The matching private key is not in this repository. It is needed only to sign a
 * packaged (.crx) connector or to keep this id when publishing to the Chrome Web Store.
 */
export const CONNECTOR_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp/9ntgtlf2RquH9N18GGTBZtfY5VGZvS0vylqUMrgd6h409PGQgg0MVuBP/Ut0uJpqKUDf8dYYtZ9tx1lYLcEw8loYwfBt+2qVAN5qYjxXl58+Bb7btnKoG/ao5YEu6ffHshEJNCqTxZcOZCt6+6lqLArjyE4RZ/qUqjw8DnkUDaVLHtvsxU4C/GYrktdh4bmxRtdn7YhmYfTRdOGXiMMbMFSCEUh7AD99wwHNM6cpdsSwJa/bjpHomzAH7yI/udP75OEwyR4G/guT3MBnQlXQkwRCdN0gHLMKP9d/c2tXr8AaRg2U0G+EVzhmz1qdqy34IpXnMyLtowLd4eSQVJ3wIDAQAB';

/** The id Chrome derives from {@link CONNECTOR_EXTENSION_KEY}. */
export const CONNECTOR_EXTENSION_ID = 'pcceapgdamkilljkpdcofekgfbejifoh';
