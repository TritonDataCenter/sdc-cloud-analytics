/*
 * ca-amqp: AMQP shim (and related facilities) for distributed system
 */

var mod_sys = require('sys');
var mod_events = require('events');
var mod_amqp = require('amqp');
var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var amqp_retry_interval_default = 5000;		/* 5 seconds in ms */
var amqp_retry_limit_default = -1;		/* Try forever */

/*
 * Manages a connection to an AMQP broker with the following properties:
 *
 *	o a single exchange is used for all messages
 *
 *	o a single exclusive queue is used for all received messages
 *
 *	o all messages are encoded as JSON objects.
 *
 * This manager does three things:
 *
 *	o Manages the connection to the AMQP broker according to an optional
 *	  disconnect-retry policy, automatically recreating the queue on
 *	  reconnect and sending messages that were queued while disconnected.
 *
 *	o Sends messages on behalf of the consumer.
 *
 *	o Dispatches received messages to the consumer via events.
 *
 * The constructor initializes the manager but doesn't actually contact the AMQP
 * broker until the 'start' method is invoked.  The constructor's 'conf'
 * argument must specify the following members:
 *
 *	broker		Describes the AMQP broker connection details, using the
 *			same form as amqp.createConnection.
 *
 *	exchange	Global exchange name.
 *
 *	exchange_opts	Global exchange creation options.
 *
 *	log		A caLog instance for logging errors.
 *
 *	queue		Queue name for this consumer.
 *
 * The constructor's 'conf' argument may also specify the following members:
 *
 *	retry_interval	Number of seconds to wait between connection retries.
 *			Default: 5 seconds
 *
 *	retry_limit	Maximum number of times to retry consecutively when an
 *			established connection to the AMQP broker is lost.  0
 *			means to avoid retrying at all.  If this field is not
 *			specified, retry indefinitely.
 *
 * This manager emits the following events:
 *
 *	amqp-error	Indicates an error occured on the AMQP service.  If the
 *			connection was closed, this object will automatically
 *			try to reconnect according to the retry policy.  Thus,
 *			this event is only for notification purposes; there's
 *			nothing to be done in response.  Argument: error.
 *
 *	amqp-fatal	Indicates a persistent failure to connect to the AMQP
 *			broker.  When this event is emitted, the retry policy
 *			has been exhausted and we've given up.  This object has
 *			stopped sending and receiving messages.  Argument:
 *			error.
 *
 *	connected	Emitted when the a new connection to the AMQP broker has
 *			been established and the exchange and queue are
 *			available.  This is emitted both after the initial
 *			connection and after a reconnect.
 *
 *	disconnected	Emitted when a valid connection to the AMQP broker is
 *			lost.  The  manager will attempt to reconnect on its
 *			own, so this is primarily for notification purposes and
 *			potentially to indicate that activity should be
 *			suspended while disconnected.
 *
 *	msg		A message was received.  Argument: the message.
 */
function caAmqp(conf)
{
	mod_events.EventEmitter.call(this);

	this.caa_msgqueue = [];
	this.caa_bindings = [];
	this.caa_nconnects = 0;
	this.caa_ndisconnects = 0;
	this.caa_ncloses = 0;

	this.caa_broker = conf['broker'];
	this.caa_exchange_name = conf['exchange'];
	this.caa_exchange_opts = conf['exchange_opts'];
	this.caa_queue_name = conf['queue'];
	this.caa_queue_opts = { exclusive: true };
	this.caa_log = conf['log'];

	this.caa_bindings.push(this.caa_queue_name);

	if (!('retry_interval' in conf))
		this.caa_retry_interval = amqp_retry_interval_default;
	else
		this.caa_retry_interval = conf['retry_interval'];

	if (!('retry_limit' in conf))
		this.caa_retry_limit = amqp_retry_limit_default;
	else
		this.caa_retry_limit = conf['retry_limit'];
}

mod_sys.inherits(caAmqp, mod_events.EventEmitter);
exports.caAmqp = caAmqp;

/*
 * Connect to the AMQP broker and begin receiving messages.
 */
caAmqp.prototype.start = function ()
{
	this.caa_closing = false;

	ASSERT(this.caa_exchange === undefined);
	ASSERT(this.caa_queue === undefined);

	this.caa_conn = mod_amqp.createConnection(this.caa_broker);
	this.caa_conn.on('ready', this.connSetup.bind(this));
	this.caa_conn.on('error', this.connError.bind(this));
	this.caa_conn.on('close', this.connClosed.bind(this));
};

/*
 * Send a given message over the global exchange to the specified routing key.
 */
caAmqp.prototype.send = function (key, msg)
{
	/*
	 * Writing over a socket which could become disconnected at any time is
	 * more complicated than expected.  If disconnections are detected
	 * asynchronously, we get them as 'error' or 'close' events.  However,
	 * it's possible that the OS detects a closed connection (e.g.,
	 * resulting from a rabbitmq zone reboot) essentially *while* we're
	 * executing JavaScript, in which case the write() invoked by the call
	 * to publish() below will fail with EPIPE, causing the appropriate
	 * 'error' and 'close' events to be enqueued.  But we can't handle those
	 * events while we're still executing.  Moreover, publish() invokes
	 * write() more than once, and subsequent write() calls will throw an
	 * exception because the socket is no longer connected.
	 *
	 * Since we already deal with the case that we're not connected by
	 * queueing the message, we first try to send it with publish() and fall
	 * back to the disconnected case if we discover now that we're
	 * disconnected.  We need not take any other action because we'll
	 * shortly handle the associated 'error' and 'close' events, reconnect,
	 * and send the queued messages when we've finished reconnecting.
	 */
	if (this.caa_exchange) {
		try {
			return (this.caa_exchange.publish(key, msg));
		} catch (ex) {
			this.caa_log.warn('amqp-error on write (socket %s ' +
			    'writable): %r', this.caa_conn.writable ?
			    'IS' : 'is NOT', ex);
			/* fall-through to disconnected case */
		}
	}

	return (this.caa_msgqueue.push({ caw_key: key, caw_msg: msg }));
};

/*
 * Creates a binding for the specified routing key to this component's queue.
 */
caAmqp.prototype.bind = function (routekey, callback)
{
	var promise;

	this.caa_bindings.push(routekey);

	/*
	 * If we're currently disconnected, pretend like we succeeded
	 * immediately because we will complete the binding before sending any
	 * queued messages out so the distinction is not visible.
	 */
	if (!this.caa_queue)
		return (callback());

	promise = this.caa_queue.bind(this.caa_exchange_name, routekey);
	return (promise.addCallback(callback));
};

/*
 * Gracefully disconnect from the AMQP broker.
 */
caAmqp.prototype.stop = function ()
{
	this.caa_closing = true;
	this.caa_conn.end();
};

/*
 * [private] Invoked after we've connected to the broker to set up the exchange
 * and queue.
 */
caAmqp.prototype.connSetup = function ()
{
	var amqp = this;

	this.caa_ncloses = 0;	/* see connClosed */

	this.caa_exchange = this.caa_conn.exchange(
	    this.caa_exchange_name, this.caa_exchange_opts);

	this.caa_exchange.on('open', function () {
		var queue;

		queue = amqp.caa_conn.queue(amqp.caa_queue_name,
		    amqp.caa_queue_opts, amqp.queueSetup.bind(amqp));
		amqp.caa_queue = queue;

		/*
		 * Subscribe to incoming messages on this queue.
		 */
		queue.subscribe(amqp.receive.bind(amqp));

		/*
		 * Listen to 'close' solely to prevent node-amqp from emitting
		 * error messages to stdout (!) on close events.
		 */
		queue.on('close', caNoop);

		/*
		 * Propagate queue errors to our consumer.  The most common
		 * queue error is that we tried to lock an exclusive queue
		 * that's already in use by someone else.
		 */
		queue.on('error', amqp.emit.bind(amqp, 'amqp-error'));
	});
};

/*
 * [private] Invoked after our queue has been successfully declared on the AMQP
 * exchange.  Here we attempt to (re-)establish our bindings.
 */
caAmqp.prototype.queueSetup = function ()
{
	var amqp, bindfuncs;

	amqp = this;
	bindfuncs = this.caa_bindings.map(this.makeBindFunc.bind(this));
	caRunParallel(bindfuncs, function (rv) {
		/*
		 * Our queue bind callbacks don't ever return failure because
		 * node-amqp doesn't expose failure directly through the queue
		 * bind callback, but rather through an "error" event on the
		 * queue itself (see above).
		 */
		ASSERT(rv.nerrors === 0);

		/*
		 * Before declaring that we're connected, flush any sent
		 * messages which accumulated while we were disconnected.
		 */
		amqp.flush();
		amqp.emit('connected');
	});
};

caAmqp.prototype.makeBindFunc = function (binding)
{
	var exchange = this.caa_exchange_name;
	var queue = this.caa_queue;
	var log = this.caa_log;

	return (function (callback) {
		var promise;

		log.dbg('binding to %s', binding);
		promise = queue.bind(exchange, binding);
		promise.addCallback(function () {
			log.dbg('bind to %s complete', binding);
			callback();
		});
	});
};

/*
 * [private] Invoked when the AMQP service encounters an error.  We emit this to
 * the consumer for logging purposes but there's no action to be taken unless
 * the connection becomes closed, which is handled elsewhere below.
 */
caAmqp.prototype.connError = function (error)
{
	this.caa_log.error('ca-amqp: received connection error: %r', error);
	this.emit('amqp-error', error);
};

/*
 * [private] Invoked when the AMQP connection has been closed, as may result
 * from an error.  If we've exceeded our consecutive retry count, we give up and
 * emit 'amqp-fatal'.
 */
caAmqp.prototype.connClosed = function ()
{
	this.caa_log.dbg('ca-amqp: received close event');

	/*
	 * A "disconnect" only occurs when we transition from connected to
	 * closed.  But node-amqp emits "close" both when an "open" fails and
	 * when an open connection is closed.  We track the number of closes
	 * since the last successful connection attempt so that we can
	 * distinguish a "close" from a connected state and a "close" resulting
	 * from a retry and so that we can tell how many times we've retried.
	 */
	if (this.caa_ncloses === 0) {
		this.caa_ndisconnects++;
		this.emit('disconnected');
	}

	this.caa_ncloses++;
	this.caa_exchange = undefined;
	this.caa_conn = undefined;
	this.caa_queue = undefined;

	/*
	 * If this was an explicit close by the consumer, we're done.
	 */
	if (this.caa_closing)
		return;

	this.caa_log.warn('ca-amqp: connection closing');

	if (this.caa_retry_limit != -1 &&
	    this.caa_ncloses >= this.caa_retry_limit) {
		this.caa_log.error('ca-amqp: reached max number of ' +
		    'reconnect attempts');
		this.emit('amqp-fatal', new caError(ECA_REMOTE, null,
		    'failed to reconnect to AMQP broker after %d attempts',
		    this.caa_ncloses - 1));
		return;
	}

	this.caa_log.info('ca-amqp: trying to reconnect (attempt %d)',
	    this.caa_ncloses);

	setTimeout(this.start.bind(this), this.caa_retry_interval);
};

/*
 * [private] Invoked when we receive a new AMQP message to dispatch to our
 * consumer.
 */
caAmqp.prototype.receive = function (msg)
{
	this.emit('msg', msg);
};

/*
 * Flush all queued messages.
 */
caAmqp.prototype.flush = function ()
{
	var msg;

	while ((msg = this.caa_msgqueue.pop()))
		this.caa_exchange.publish(msg.caw_key, msg.caw_msg);
};

/*
 * Returns an object with debug information.
 */
caAmqp.prototype.info = function ()
{
	var ret = {};
	ret['ncloses'] = this.caa_ncloses;
	ret['nconnects'] = this.caa_nconnects;
	ret['ndisconects'] = this.caa_ndisconnects;
	ret['exchange'] = this.caa_exchange_name;
	ret['exchange_opts'] = this.caa_exchange_opts;
	ret['queue_name'] = this.caa_queue_name;
	ret['retry_interval'] = this.caa_retry_interval;
	ret['retry_limit'] = this.caa_retry_limit;
	ret['bindings'] = caDeepCopy(this.caa_bindings);
	ret['broker'] = this.caa_broker;

	/* Determine the status */
	if (this.caa_queue)
		ret['status'] = 'connected, with queue';
	else if (this.caa_exchange)
		ret['status'] = 'connected, waiting for queue create';
	else if (this.caa_conn)
		ret['status'] = 'trying to (re)connect';
	else if (this.caa_closing)
		ret['status'] = 'stopped';
	else
		ret['status'] = 'never started';

	return (ret);
};

/*
 * Error codes defined by the AMQP specification.
 */
exports.NOT_DELIVERED = 310;
exports.CONTENT_TOO_LARGE = 311;
exports.CONNECTION_FORCED = 320;
exports.INVALID_PATH = 402;
exports.ACCESS_REFUSED = 403;
exports.NOT_FOUND = 404;
exports.RESOURCE_LOCKED = 405;
exports.FRAME_ERROR = 501;
exports.SYNTAX_ERROR = 502;
exports.COMMAND_INVALID = 503;
exports.CHANNEL_ERROR = 504;
exports.RESOURCE_ERROR = 506;
exports.NOT_ALLOWED = 530;
exports.NOT_IMPLEMENTED = 540;
exports.INTERNAL_ERROR = 541;
