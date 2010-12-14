/*
 * caadmin.js: very basic admin view for CA
 */

var aServer = window.location.hostname;
var aGraph = 'http://' + aServer + ':' + window.location.port + '/graph.htm';
var aBaseUrl = 'http://' + aServer + ':23181/ca';
var aUrlMetrics = aBaseUrl + '/metrics';
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
	var request;

	request = new XMLHttpRequest();
	request.open('GET', aUrlMetrics, true);
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

	url = aBaseUrl;

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
	var data, datum, custid, ii, instrumentation, module, stat;

	data = [];
	for (ii = 0; ii < instrumentations.length; ii++) {
		instrumentation = instrumentations[ii];
		custid = instrumentation.customer_id || 'Global';
		module = aMetrics[instrumentation.modname];
		stat = module['stats'][instrumentation.statname];
		datum = [
		    custid, module['label'], stat['label'],
		    instrumentation.decomp.join(', ') || 'None',
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
