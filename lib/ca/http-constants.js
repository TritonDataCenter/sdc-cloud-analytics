/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * http-constants: common HTTP constants
 */

exports.OK			= '200';	/* OK */
exports.CREATED			= '201';	/* Created */
exports.ACCEPTED		= '202';	/* Accepted */
exports.NOCONTENT		= '204';	/* No Content */
exports.EBADREQUEST		= '400';	/* Bad Request */
exports.ENOTFOUND		= '404';	/* Not Found */
exports.EBADMETHOD		= '405';	/* Method Not Allowed */
exports.ECONFLICT		= '409';	/* Conflict */
exports.ETOOLARGE		= '413';	/* Request Entity Too Large */
exports.EUNSUPMEDIATYPE		= '415';	/* Unsupported Media Type */
exports.ESERVER			= '500';	/* Internal Server Error */
exports.ESRVUNAVAIL		= '503';	/* Service Unavailable */
