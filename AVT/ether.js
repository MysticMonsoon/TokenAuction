//
// couple of utility fcn to do things relating to eth via etherscan.io
//   - check balance
//   - send eth
//
var common = require('./common');
var ethUtils = require('ethereumjs-util');
var ethabi = require('ethereumjs-abi');
var ethtx = require('ethereumjs-tx');
var Buffer = require('buffer/').Buffer;
var BN = require("bn.js");
var WEI_PER_FINNEY = 1000000000000000;
var NOMINAL_GAS_LIMIT = 40000;
var ETHERSCAN_APIKEY = "VRPDB8JW4CHSQV6A6AHBMGFWRA1E9PR6BC";

var cached_block_count = "";
var block_count_refresh_sec = 0;
var DEFAULT_GAS_PRICE = 10000000000;
var history_min_price = DEFAULT_GAS_PRICE;
var price_refresh_sec = 0;

var ether = module.exports = {

    abi_encode_disqualifyBid: function() {
	common.logDebug('ether.abi_encode_disqualifyBid');
	encoded = ethabi.methodID('disqualifyBid', [ 'address' ]).toString('hex');
	return(encoded);
    },

    abi_encode_disqualifyBid_parms: function(bidderAddr, refundFlag) {
	common.logDebug('ether.abi_encode_disqualifyBid_parms');
	encoded = ethabi.rawEncode([ 'address', 'bool' ], [ bidderAddr, refundFlag ] ).toString('hex');
	return(encoded);
    },

    abi_encode_expireBid: function() {
	common.logDebug('ether.abi_encode_expireBid');
	encoded = ethabi.methodID('expireBid', [ 'address' ]).toString('hex');
	return(encoded);
    },

    abi_encode_expireBid_parms: function(bidderAddr) {
	common.logDebug('ether.abi_encode_expireBid_parms');
	encoded = ethabi.rawEncode([ 'address' ], [ bidderAddr ] ).toString('hex');
	return(encoded);
    },

    //
    // get current block count
    //
    get_block_count: function(callback) {
	common.logDebug('ether.get_block_count');
	var count = -1;
	var now_sec = Math.floor(Date.now() / 1000);
	if (now_sec - block_count_refresh_sec < 5) {
	    callback(cached_block_count);
	    return;
	}
	var url = 'https://api.etherscan.io/api?module=proxy&action=eth_blockNumber';
	common.fetch(url, function(str, err) {
	    if (!str || !!err) {
		common.logDebug("get_block_count err: " + err);
		callback(cached_block_count);
	    } else {
		//typical response is:
		// {"jsonrpc":"2.0","result":"0x2f796a","id":83}
		var blockResp = JSON.parse(str);
		var blockHexStr = blockResp.result;
		if (!!blockHexStr) {
		    count = parseInt(blockHexStr, 16);
		    cached_block_count = count;
		}
		callback(count);
	    }
	});
    },

    private_key_to_addr: function(key, callback) {
	common.logDebug('in ether.private_key_to_addr(' + key + ')');
	key = '0x' + key;
	var err = null;
	var acct_addr = '';
	try {
	    acct_addr = ethUtils.privateToAddress(key).toString('hex')
	    common.logDebug('ether.private_key_to_addr: got ' + acct_addr + '; calling callback...');
	    acct_addr = '0x' + acct_addr;
	} catch (key_err) {
	    err = key_err;
	}
	callback(err, acct_addr);
    },


    get_gas_price: function(callback) {
	var now_sec = Math.floor(Date.now() / 1000);
	if (now_sec - price_refresh_sec < 10 * 60) {
	    callback(history_min_price);
	    return;
	}
	var priceURL = 'https://api.etherscan.io/api?module=proxy&action=eth_gasPrice'
	common.logDebug('ether.get_gas_price: url = ' + priceURL);
	common.fetch(priceURL, function(str, err) {
	    var price = history_min_price;
	    if (!str || !!err) {
		common.logDebug("ether.get_gas_price: err = " + err);
	    } else {
		//typical response is:
		// {"jsonrpc":"2.0","result":"0x4e3b29200","id":73}
		var gasResp = JSON.parse(str);
		var priceHexStr = gasResp.result;
		if (!!priceHexStr) {
		    price = parseInt(priceHexStr, 16);
		    common.logDebug("ether.get_gas_price: price = " + price);
		    price_refresh_sec = Math.floor(Date.now() / 1000);
		    history_min_price = price;
		}
	    }
	    callback(price);
	});
    },


    //
    // get balance of an acct (returned as string)
    // returns the current balance of the acct, as read from etherscan.io. no provisions are made for pending transactions.
    //
    getBalance: function(acct, size_is_finney, callback) {
	common.logDebug('ether.getBalance(' + acct + ', ' + size_is_finney + ')');
	var balance = -1;
	var url = 'https://api.etherscan.io/api?module=account&action=balance&address=' + acct + '&tag=latest';
	common.fetch(url, function(str, err) {
	    if (!str || !!err) {
		common.logDebug("get_balance  err: " + err);
		callback(balance);
	    } else {
		common.logDebug('get_balance resp = ' + str);
		//typical response is:
		// {"status":"1","message":"OK","result":"740021584819750779479303"}
		var balanceResp = JSON.parse(str);
		var balance = balanceResp.result;
		common.logDebug('get_balance bal = ' + balance);
		if (size_is_finney) {
		    var big_wei_balance = new BN(balance);
		    var wei_per_finney = new BN(WEI_PER_FINNEY);
		    big_wei_balance = big_wei_balance.div(wei_per_finney);
		    balance = big_wei_balance.toString();
		}
		common.logDebug('ether.get_balance: calling callback...');
		callback(balance);
	    }
	});
    },

    //
    //send fcn that uses the default broadcast fcn
    //
    send: function(acct, key, to_addr, size, size_is_finney, gas_limit, data, callback) {
	common.logDebug('ether.send');
	var broadcast_fcn = ether.broadcast_tx;
	serial_send(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback);
    },


    //
    //broadcast_fcn should be eg. broadcast_tx(tx, function(err, txid))
    //
    raw_send: function(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback) {
	common.logDebug('ether.raw_send');
	serial_send(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback);
    },


    //
    //default broadcast fcn uses etherscan.io
    //callback args are err, txid
    //
    broadcast_tx: function(tx, callback) {
	common.logDebug('ether.broadcast_tx');
	var url = 'https://api.etherscan.io/api?module=proxy&action=eth_sendRawTransaction&hex=' + tx + '&apikey=' + ETHERSCAN_APIKEY;
	common.fetch(url, function(str, err) {
	    if (!str || !!err) {
		common.logDebug('ether.broadcast_tx: err = ' + err);
		callback(err, '');
	    } else {
		//typical response is:
		//{ "jsonrpc": "2.0", "result": "0xd22456131597cff2297d1034f9e6f790e9678d85c041591949ab5a8de5f73f04", "id": 1 }
		// alternately:
		// { "jsonrpc":"2.0","error": {"code":-32010, "message": "Transaction nonce is too low. Try incrementing the nonce.","data": null},"id":1 }
		var broadcastResp = JSON.parse(str);
		var txid = broadcastResp.result;
		if (!txid) {
		    common.logDebug("ether.broadcast_tx: failed! reponse is: " + str);
		    err = broadcastResp.error.message;
		}
		callback(err, txid);
	    }
	});
    },
};



/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
   we serialize calls to get-nonce, get-gas-price, create-signed-tx, and broadcast-tx
   the main point of the serialization is to increment the nonce, exactly once at the end of every successful send; and to always use the next nonce at the start of
   each new send.
   ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ */
function Send_Info(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback) {
    this.acct = acct;
    this.key = key;
    this.to_addr = to_addr;
    this.size = size;
    this.size_is_finney = size_is_finney;
    this.gas_limit = gas_limit;
    this.data = data;
    this.broadcast_fcn = broadcast_fcn;
    this.callback = callback;
}

var send_list = [];

function serial_send(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback) {
    common.logDebug('ether.serial_send');
    var send_info = new Send_Info(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback);
    send_list.push(send_info);
    if (send_list.length == 1)
	send_next();
}

function send_next() {
    common.logDebug('ether.send_next');
    if (send_list.length > 0) {
	var send_info = send_list[0];
	send_guts(send_info.acct, send_info.key, send_info.to_addr, send_info.size, send_info.size_is_finney, send_info.gas_limit, send_info.data, send_info.broadcast_fcn,
		  function(txid) {
		      //even thought the send is complete, we don't delete the head entry from the send_list, until we
		      //are ready to process the next entry. this is to prevent any intervening calls to serial send, which
		      //would have also called send_next
		      send_info.callback(txid);
		      send_list.splice(0, 1);
		      if (send_list.length > 0)
			  send_next();
		  });
    }
}




//
//do a transaction
//we do not call the callback fcn until after the broadcast fcn returns
//
function send_guts(acct, key, to_addr, size, size_is_finney, gas_limit, data, broadcast_fcn, callback) {
    common.logDebug('ether.send_guts');
    get_nonce(acct, function(nonce) {
	ether.get_gas_price(function(gas_price) {
	    var last_nonce = parseInt(nonce);
	    if (isNaN(last_nonce) || last_nonce < nonce_history) {
		console.log("send_guts: retrieved nonce, " + nonce + " is less than historical nonce, " + nonce_history + " -- using historical nonce...");
		last_nonce = nonce_history;
	    }
	    var next_nonce = last_nonce + 1;
	    common.logDebug("ether.send_guts: nonce = " + next_nonce + ", gas_price = " + gas_price);
	    var tx = create_signed_tx(key, to_addr, size, size_is_finney, data, next_nonce, gas_limit, gas_price);
	    broadcast_fcn(tx, function(err, txid) {
		if (!txid && !!err && err.indexOf("nonce is too low") >= 0) {
		    nonce_history = next_nonce;
		    send_guts(acct, key, to_addr, size, size_is_finney, data, broadcast_fcn, callback);
		    return;
		}
		if (!!txid && (isNaN(nonce_history) || nonce_history < next_nonce)) {
		    //it can't happen anymore that nonce_history is NaN.... but it used to be that we had a bug in which last_nonce was NaN,
		    //so next_nonce was NaN, so when the tx would fail (w/ nonce too low) then nonce_history would become NaN... then when we
		    //would finally get a valid nonce from get_nonce, we would not update nonce_history, cuz NaN is not lt next_nonce. so
		    //even though it can't happen anymore, now we update nonce_history if it ever becomes NaN...
		    nonce_history = next_nonce;
		}
		common.logDebug('ether.send_guts: txid = ' + txid);
		callback(txid);
	    });
	});
    });
}


var nonce_history = -1;
function get_nonce(acct, callback) {
    var nonce = -1;
    var nonce_URL = 'https://api.etherscan.io/api?module=proxy&action=eth_getTransactionCount&address=' + acct + '&tag=latest';
    common.logDebug('ether.get_nonce');
    common.fetch(nonce_URL, function(str, err) {
	if (!str || !!err) {
	    common.logDebug("ether.get_nonce: err = " + err);
	} else {
	    //typical response is:
	    // {"jsonrpc":"2.0","result":"0xaf5d","id":1}
            //note that first payment nonce is 0; so if you've never made a payment then we have a convention that our "last-used-nonce" is -1.
            //the get-nonce api on etherchain.org used to provide the actual nonce value from the last transaction. etherscan.io however is actually
	    //giving the number of transactions sent from an address. that is, if an address has never been used, then the count is 0 -- so we
	    //subtract one to get the "last-used-nonce."
	    common.logDebug("ether.get_nonce: str = " + str);
	    var txCntResp = JSON.parse(str);
	    var txCntHexStr = txCntResp.result;
	    if (!!txCntHexStr) {
		var txCnt = parseInt(txCntHexStr, 16);
		nonce = txCnt - 1;
	    }
	    common.logDebug("ether.get_nonce: nonce = " + nonce);
	}
	callback(nonce);
    });
}


var DEFAULT_GAS_PRICE = 10000000000;
var price_refresh_sec = 0;
var history_min_price = DEFAULT_GAS_PRICE;
var price_history = [ Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
		      Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
		      Number.MAX_SAFE_INTEGER ];
function get_gas_price(callback) {
    common.logDebug('ether.get_gas_price');
    var now_sec = Math.floor(Date.now() / 1000);
    if (now_sec - price_refresh_sec < 10 * 60) {
	callback(history_min_price);
	return;
    }
    var priceURL = 'https://api.etherscan.io/api?module=proxy&action=eth_gasPrice'
    common.fetch(priceURL, function(str, err) {
	if (!str || !!err) {
	    common.logDebug("ether.get_gas_price: err = " + err);
	    callback(history_min_price);
	} else {
	    //typical response is:
	    // {"jsonrpc":"2.0","result":"0x4e3b29200","id":73}
	    var gasResp = JSON.parse(str);
	    var priceHexStr = gasResp.result;
	    var cur_price = '';
	    if (!!priceHexStr) {
		cur_price = parseInt(priceHexStr, 16);
		common.logDebug("ether.get_gas_price: price = " + cur_price);
	    }
	    if (!!cur_price) {
		var max_price = 0;
		var min_price = Number.MAX_SAFE_INTEGER;
		for (var i = 0; i < price_history.length; ++i) {
		    price_history[i] = (i < price_history.length - 1) ? price_history[i + 1] : cur_price;
		    if (price_history[i] < min_price)
			min_price = price_history[i];
		    if (price_history[i] > max_price)
			max_price = price_history[i];
		}
		history_min_price = Math.min(min_price * 1.25, max_price);
		//don't update the timestamp till we have collected complete price history. that way, in the beginning, we collect a new sample for each request
		if (max_price < Number.MAX_SAFE_INTEGER)
		    price_refresh_sec = Math.floor(Date.now() / 1000);
	    }
	    callback(history_min_price);
	}
    });
}


function create_signed_tx(key, to_addr, size, size_is_finney, data, nonce, gas_limit, gas_price) {
    common.logDebug('ether.create_signed_tx');
    var key_hex = new Buffer(key, 'hex');
    var big_wei_size = new BN(size);
    if (size_is_finney) {
	var wei_per_finney = new BN(WEI_PER_FINNEY);
	big_wei_size = big_wei_size.mul(wei_per_finney);
    }
    var big_gas_limit = new BN(gas_limit);
    var big_gas_price = new BN(gas_price);
    var big_nonce = new BN(nonce);
    var tx = new ethtx(null);
    tx.nonce = big_nonce.toBuffer();
    tx.gasPrice = big_gas_price.toBuffer();
    tx.gasLimit = big_gas_limit.toBuffer();
    tx.to = to_addr,
    tx.value = big_wei_size.toBuffer();
    tx.data = data;
    tx.sign(key_hex);
    //common.logDebug("wei required = " + tx.getUpfrontCost().toString());
    var serialized_tx = tx.serialize();
    var hex_serialized_tx = serialized_tx.toString('hex');
    return(hex_serialized_tx);
}
