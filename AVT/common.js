//
// common functions
// most basic level fcns and definitions; that is fcns that do not require any other packages.
// this module can be required by everyone
//
var fetch = require('node-fetch');

var common = module.exports = {

    SHOW_DEBUG: false,

    logDebug: function(msg) {
	if (common.SHOW_DEBUG)
	    console.log(msg);
    },

    leftPadTo: function(str, desiredLen, ch) {
	var padChar = (typeof ch !== 'undefined') ? ch : ' ';
	var pad = new Array(1 + desiredLen).join(padChar);
	var padded = (pad + str.toString()).slice(-desiredLen);
	return padded;
    },

    rightPadTo: function(str, desiredLen) {
	var bigPad = '                                                                                                    ';
	return((str + bigPad).slice(0, desiredLen));
    },

    fetch: function(url, callback) {
	var timeout = false;
	var complete = false;
	var fetch_timer = setTimeout(function() {
	    timeout = true;
	    if (complete == true) {
		return;
	    } else {
		console.log('fetch: fetching ' + url);
		console.log("fetch: timeout retrieving " + url);
		callback("", "timeout");
	    }
	}, 10000);
	common.logDebug('fetch: fetching ' + url);
	fetch(url, { mode: 'cors'} ).then(function(resp) {
	    //console.log('fetch: got resp = ' + resp + ', status = ' + resp.status + ', (' + resp.statusText + ')');
	    clearTimeout(fetch_timer);
	    complete = true;
	    if (timeout == true) {
		console.log('fetch: fetching ' + url);
		console.log("fetch: fetch returned after timeout! url = " + url);
		return;
	    }
	    if (resp.ok) {
		resp.text().then(function(str) {
		    callback(str, "");
		});
	    } else {
		console.log('fetch: fetching ' + url);
		console.log("fetch: got err = " + resp.blob());
		callback("", "unknown");
	    }
	}).catch(function(error) {
	    console.log('fetch: fetching ' + url);
	    console.log("fetch: exeption = " + error);
	    complete = true;
	    callback("", error);
	});
    },


    //
    // extract a field from json input. assumes that the field identifier is unique in the passed message.
    // commas not allowed in fields...
    //
    extract_json_field: function (msg, field) {
	var value = "";
	var extra_quote = 0;
	var start_idx = msg.indexOf(field + ":");
	if (start_idx < 0) {
	    var start_idx = msg.indexOf(field + "\":");
	    ++extra_quote;
	}
	if (start_idx >= 0) {
	    start_idx += field.length + extra_quote + 1;
	    value = msg.substring(start_idx).trim();
	    if (value.startsWith('"')) {
		value = value.substring(1);
		var match_quote_idx = value.indexOf('"');
		if (match_quote_idx >= 0)
		    value = value.substring(0, match_quote_idx);
	    } else {
		var re = /[ ,}]/;
		var match = re.exec(value);
		if (match != null)
		    value = value.substring(0, match.index);
		value = value.replace(/"/g, "");
	    }
	    //console.log("field: " + field + ", value: " + value);
	}
	return(value);
    },

};
