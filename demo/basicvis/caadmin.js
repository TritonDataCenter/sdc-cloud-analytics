/*
 * caadmin.js: very basic admin view for CA
 */

var gServer = window.location.hostname;
var gPort = 23181;		/* config service HTTP port */
var aGraph = 'http://' + window.location.hostname + ':' +
    window.location.port + '/graph.htm';
var aMetrics = [];
var aCustid;
var aTable;
var aData;

window.onload = function ()
{
	var div, columns;

	div = document.getElementById('aContainerDiv');

	columns = [
		{ sTitle: 'Customer ID' },
		{ sTitle: 'Module' },
		{ sTitle: 'Stat' },
		{ sTitle: 'Decompositions' },
		{ sTitle: 'View' }
	];

	aTable = $(div).dataTable({
		aaData: [],
		bFilter: false,
		bJQueryUI: true,
		bAutoWidth: true,
		bPaginate: false,
		bScrollInfinite: true,
		aoColumns: columns,
		fnRowCallback: aDrawRow,
		oLanguage: {
			sEmptyTable: 'No instrumentations.'
		}
	});

	aInitMetrics();
};

function aDrawRow(tr, data)
{
	var custid = data[0];
	var viewtd = tr.childNodes[tr.childNodes.length - 1];
	var viewaa;

	if (viewtd.firstChild)
		return (tr);

	viewaa = document.createElement('a');
	viewaa.target = '_blank';
	viewaa.href = aGraph + '#';
	viewaa.appendChild(document.createTextNode('view'));

	if (custid != 'Global')
		viewaa.href += custid;

	viewtd.appendChild(viewaa);
	return (tr);
}

/*
 * Load the available metrics from the server to populate the UI.
 */
function aInitMetrics()
{
	var url = 'http://' + gServer + ':' + gPort + '/ca/metrics';
	var request;

	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load metric list');
			return;
		}

		aInitMetricsFini(JSON.parse(request.responseText));
	};
}

/*
 * Finish loading the available metrics from the server.
 */
function aInitMetricsFini(metrics)
{
	aMetrics = metrics;
	setTimeout(aTick, 0);
}

function aTick()
{
	aRefresh(function () { setTimeout(aTick, 1000); });
}

function aRefresh(callback)
{
	var url;
	var request;

	url = 'http://' + gServer + ':' + gPort + '/ca';

	if (aCustid !== undefined)
		url += '/customers/' + aCustid;

	url += '/instrumentations/';

	request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.send(null);
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load latest data');
			callback();
			return;
		}

		aUpdateTable(JSON.parse(request.responseText));
		callback();
	};
}

function aUpdateTable(instrumentations)
{
	var data, datum, custidx, custid, ii, instrumentation;
	var module, stat, uri;

	data = [];
	for (ii = 0; ii < instrumentations.length; ii++) {
		instrumentation = instrumentations[ii];
		uri = instrumentation.uri;
		custidx = uri.indexOf('/customers/');
		if (custidx == -1) {
			custid = 'Global';
		} else {
			custid = uri.substring(custidx + '/customers/'.length);
			custid = custid.substring(0, custid.indexOf('/'));
		}
		module = aMetrics[instrumentation.module];
		stat = module['stats'][instrumentation.stat];
		datum = [
		    custid, module['label'], stat['label'],
		    instrumentation.decomposition.join(', ') || 'None',
		    ''
		];
		data.push(datum);
	}

	if (aData && aData.length > 0)
		aTable.fnClearTable();

	aTable.fnAddData(data);
	aTable.fnDraw();
	aData = data;
}
