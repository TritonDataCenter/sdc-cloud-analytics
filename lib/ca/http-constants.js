/*
 * http-constants: common HTTP constants
 */

exports.OK			= '200';
exports.MSG_OK			= 'ok';
exports.CREATED			= '201';
exports.MSG_CREATED		= 'created';
exports.ACCEPTED		= '202';
exports.MSG_ACCEPTED		= 'accepted';
exports.EBADREQUEST		= '400';
exports.MSG_EBADREQUEST		= 'bad request';
exports.ENOTFOUND		= '404';
exports.MSG_ENOTFOUND		= 'not found';
exports.EBADMETHOD		= '405';
exports.MSG_EBADMETHOD		= 'method not allowed';
exports.ETOOLARGE		= '413';
exports.MSG_ETOOLARGE		= 'request entity too large';
exports.EUNSUPMEDIATYPE		= '415';
exports.MSG_EUNSUPMEDIATYPE	= 'unsupported media type';
exports.ESERVER			= '500';
exports.MSG_ESERVER		= 'internal server error';

/*
 * Extract a single-valued form field.  If there's more than one, pick the
 * first.
 */
exports.oneParam = function (params, field)
{
	if (!(field in params))
		return (undefined);

	if (params[field].constructor == Array)
		return (params[field][0]);

	return (params[field]);
};
