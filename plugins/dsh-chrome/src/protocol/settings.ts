/**
 * Where dsh-chrome's settings live in DSH: the Loader row that runs dsh-chrome's host plugin.
 * The row's configuration is the settings; DSH's plugin settings page shows a row's page
 * under the key `<package>#<row id>`, and DSH's settings service names the row's form by the
 * row's id.
 *
 * This module is shared by the build, the host plugin and the browser client.
 */

/** The id of the Loader row that runs dsh-chrome's host plugin. */
export const HOST_ROW_ID = 'dsh-chrome';
