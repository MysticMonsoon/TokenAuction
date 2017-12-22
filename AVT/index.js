
//
// args:
// --invalidate: invalidate any bids whose hash's don't match their encrypted bid data
// --expire: expitr any stale bids. execute this after the end of the sale period
//
//
var common = require('./common');
var ether = require('./ether');
var NodeRSA = require('node-rsa');
var Buffer = require('buffer/').Buffer;
var ethUtils = require('ethereumjs-util');
var BN = require("bn.js");
const keccak = require('keccakjs');

// acct is the owner of the TokenAuction contract. needed for disqualifyBid
var ACCT = "";
var PRIVATE_KEY = "";
var CONTRACT_ADDR = "";
//
// MAX_TOKENS, like all other token quantities here, refer to whole tokens; that is, 1000
// low-level tokens (assuming that the tokens have 3 decimals).
//
var MAX_TOKENS = 10000005;
//
var SUBMIT_BID_TOPIC0 = "0xe15b694b705acb702334150b898bb2a2646b7bd2748a22f26c36e6ba7cb89f1c";
var EXECUTE_BID_TOPIC0 = "0xf3f4e84227586e797977952ce09ff57aa48556bbd992e1f611cc2c3f6fb1f745";
var STATE_EVENT_TOPIC0 = "0xc4d1978aca5dbd557298da69c7a31a5dec628dce416e9a721f63665722865502";
var ETHERSCAN_APIKEY = "";
// auction state (from contract events)
var AUCTION_START_EVENT = 0x01;
var AUCTION_END_EVENT   = 0x02;
var SALE_START_EVENT    = 0x04;
var SALE_END_EVENT      = 0x08;

var WEI_PER_SZABO = 1000000000000;
var SZABO_PER_ETH = 1000000;
var SHOW_BAD_BIDS = true;
var EXPIRE_BIDS = false;
var INVALIDATE_BIDS = false;
var INVALIDATE_ALL_BIDS = false;
var MIN_FINNEY_TO_INVALIDATE = 1000;
var MAX_ETH_PRICE = 100;

//
// this is the private that corresponds to the public key in SBT/bidUtils.js
//
    var auctioneerPrivkey =
'-----BEGIN RSA PRIVATE KEY-----\n' +
'THE AUCTOINEERS REAL PRIVATE KEY SHOULD BE HERE' +
'-----END RSA PRIVATE KEY-----';


/* --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
   entrypoint is here
   bids are organized into batches within the acution contract. the function processBidBatch processes all bids from a specified batch; the function
   processNextBidBatch calls processBidBatch, and then calls itself recursively to process the next batch, until it encounters an empty batch.
   our algorythm for finding the optimal strike price is very simple: sort the bids from highest to lowest; then progressivly lower the strike-price, keeping
   track of what proce yeilds the greatest proceeds. note that you can't just quit the first time you encounter a bid that would yield less; that's cuz a low
   bid might reduce the proceeds due to the fact that very few tokens would be purchased at that price (and it lowers the price for all tokens) -- while the
   the next lower bid might actually increase the proceeds, if there are a large number of tokens.
   -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */
var bids = [];
var quantity_count = 0;
var key = new NodeRSA(auctioneerPrivkey);


//
// entrypoint
//
process.argv.forEach(function (val, index, array) {
    if (index >= 2) {
	if (val == '--debug')
	    common.SHOW_DEBUG = true;
	else if (val == '--expire')
	    EXPIRE_BIDS = true;
	else if (val == '--invalidate')
	    INVALIDATE_BIDS = true;
	else {
	    console.log('Unknown command line parameter: ' + val);
	    return;
	}
    }
    if (index >= array.length - 1)
	checkBalance();
});
function checkBalance() {
    if (!CONTRACT_ADDR || !ETHERSCAN_APIKEY) {
	console.log('You must set contract addr and etherscan api key.');
	return;
    }
    if (INVALIDATE_BIDS || INVALIDATE_ALL_BIDS || EXPIRE_BIDS) {
	if (!PRIVATE_KEY) {
	    console.log('You need the owner private key to invalidate or expire bids.');
	    return;
	}
	//better make sure we have some funds
	var SIZE_IS_FINNEY = true;
	ether.getBalance(ACCT, SIZE_IS_FINNEY, function(finneyBalance) {
	    console.log('finneyBalance = ' + finneyBalance);
	    if (finneyBalance < MIN_FINNEY_TO_INVALIDATE) {
		console.log('You don\'t have enough ETH in this account to invalidate bids.');
		return;
	    }
	    doWork();
	});
    } else {
	doWork();
    }
}
function doWork() {
    //if we are configure to expire stale bids, then collect all bids, and ensure that they have
    //all been executed
    if (EXPIRE_BIDS) {
	console.log('Expire Stale Bids Operation');
	console.log('---------------------------');
	getState(function(state) {
	    if (!(state & SALE_END_EVENT)) {
		console.log("You cannot expire bids until the auction sale has ended");
		return;
	    }
	    collectAllBids(function(bids) {
		expireAllStale(bids);
	    });
	});
    } else {
	console.log('Calc Strike Price Operation');
	console.log('---------------------------');
	collectAllBids(function(bids) {
	    calcStrikePrice(bids);
	});
    }
}

//just a wrapper.. will call callback after all bids have been collected to bids[]
function collectAllBids(cb) {
    console.log('collecting all bids...')
    processNextBidBatch(0, 0, function() {
	cb(bids);
    });
}


//
// calc strike parice based on all bids
//
function calcStrikePrice(bids) {
    //add one bogus bid, with a price of zero. the strike-price determination loop will always stop without including this bid,
    //since it would always lower the proceeds drastically.
    var fakeBid = new Bid('0x0', 0, MAX_TOKENS);
    bids.push(fakeBid);
    sortAndPruneBids();
    if (bids.length < 2) {
	console.log('have ' + bids.length - 1 + ' bids. exit.');
    } else {
	console.log('\nComputing Strike-Price (' + (bids.length - 1) + ' bids)');
	console.log('\nAll prices are in SZABO! (unless converted to eth)');
	console.log('---------------------------------------------------');
	var prevStrikePrice = Number.MAX_SAFE_INTEGER;
	var prevProceeds = 0;
	var prevQuantity = 0;
	var testQuantity = 0;
	var strikePricePctX10 = 1000;
	var testStrikePricePctX10 = 1000;
	console.log(common.leftPadTo('Strike-Price', 22) + ' (' + common.rightPadTo('ETH', 8) + ')  ==> ' +
		    common.leftPadTo('Quantity', 8) + ' ==> ' + common.leftPadTo('Proceeds', 25) + ' (' + common.rightPadTo('ETH', 8) + ')');
	console.log(common.leftPadTo('------------', 22) + ' (' + common.rightPadTo('---', 8) + ')  ==> ' +
		    common.leftPadTo('--------', 8) + ' ==> ' + common.leftPadTo('--------', 25) + ' (' + common.rightPadTo('---', 8) + ')');
	for (var i = 0; i < bids.length; ++i) {
	    if (testQuantity + bids[i].quantity > MAX_TOKENS) {
		//only a fraction of these bids can possibly be accepted
		var allowed = MAX_TOKENS - testQuantity;
		testStrikePricePctX10 = (allowed * 1000) / bids[i].quantity;
	    }
	    testQuantity += (bids[i].quantity * testStrikePricePctX10) / 1000;
	    var testProceeds = bids[i].szaboPrice * testQuantity;
	    var testProceedsETH = testProceeds / SZABO_PER_ETH;
	    var testStrikePriceETH = bids[i].szaboPrice / SZABO_PER_ETH;
	    console.log(common.leftPadTo(bids[i].szaboPrice, 22) + ' (' + common.rightPadTo(testStrikePriceETH, 8) + ')  ==> ' +
			common.leftPadTo(testQuantity, 8) + ' ==> ' + common.leftPadTo(testProceeds, 25) + ' (' + common.rightPadTo(testProceedsETH, 8) + ')');
	    if (testProceeds > prevProceeds) {
		prevProceeds = testProceeds;
		prevQuantity = testQuantity;
		prevStrikePrice   = bids[i].szaboPrice;
		strikePricePctX10 = testStrikePricePctX10;
	    }
	    if (testStrikePricePctX10 != 1000)
		break;
	}
	var proceedsETH = prevProceeds / SZABO_PER_ETH;
	var strikePriceETH = prevStrikePrice / SZABO_PER_ETH;
	console.log('\nOPTIMAL STRIKE-PRICE:');
	console.log(common.leftPadTo('Strike-Price', 22)  + ' (' + common.rightPadTo('ETH', 8) + ')  ==> ' + common.leftPadTo('Quantity', 8) +
		    ' ==> ' + common.leftPadTo('Proceeds', 25) + ' (' + common.rightPadTo('ETH', 8) + ')');
	console.log(common.leftPadTo('------------', 22)  + ' (' + common.rightPadTo('---', 8) + ')  ==> ' + common.leftPadTo('--------', 8) +
		    ' ==> ' + common.leftPadTo('--------', 25) + ' (' + common.rightPadTo('---', 8) + ')');
	console.log(common.leftPadTo(prevStrikePrice, 22) + ' (' + common.rightPadTo(strikePriceETH, 8) + ')  ==> ' + common.leftPadTo(prevQuantity, 8) +
		    ' ==> ' + common.leftPadTo(prevProceeds, 25) + ' (' + common.rightPadTo(proceedsETH, 8) + ')');
	console.log('\nstrikePricePctX10 = ' + strikePricePctX10);
    }
}


//
// expire all stale bids
//
function expireAllStale(bids) {
    if (bids.length < 1) {
	console.log('no bids... exit.');
	return;
    }
    console.log('\nChecking for stale bids (' + bids.length + ' bids)');
    console.log('---------------------------------------------------');
    checkNextStaleBid(bids, function() {
    });
}


function logBadBid(msg) {
    if (SHOW_BAD_BIDS)
	console.log(msg);
}

function Bid(bidder, szaboPrice, quantity) {
    this.bidder = bidder;
    this.szaboPrice = szaboPrice;
    this.quantity = quantity;
}
function bidSort(a, b) {
    //ltz: a < b
    //gtz: a > b
    //be default the array is sorted in ascending order; but we want decending, so:
    return(b.szaboPrice - a.szaboPrice);
}

function sortAndPruneBids() {
    console.log('\nSorting and combining equivalent bids');
    console.log('-------------------------------------');
    bids.sort(bidSort);
    //now combine bids that have the same price
    for (var i = 0; i < bids.length; ++i) {
	var j = i + 1;
	while (j < bids.length && bids[i].szaboPrice == bids[j].szaboPrice) {
	    bids[i].quantity += bids[j].quantity
	    bids[i].bidder = 'combined-bid';
	    bids.splice(j, 1);
	}
	console.log(common.leftPadTo(bids[i].quantity, 6) + ' tokens @ ' + bids[i].szaboPrice + ' szabo');
    }
}


//will call itself recursively to process all bid batches; last call will call the callback fcn.
function processNextBidBatch(batch, tryCount, cb) {
    common.logDebug('processNextBidBatch: batch #' + batch);
    processBidBatch(batch, function(err, howManyProcessed) {
	if (!!err) {
	    console.log('error on batch #' + batch + ': ' + err);
	    processNextBidBatch(batch, tryCount, cb);
	    return;
	} else if (howManyProcessed == 0) {
	    //sometimes etherscan.io gives us an empty list.... why?
	    if (tryCount >= 3) {
		console.log('batch #' + batch + ' is empty.... all done');
		cb();
	    } else {
		console.log('batch #' + batch + ' is empty.... try again');
		setTimeout(function() {
		    processNextBidBatch(batch, tryCount + 1, cb);
		}, 3000);
	    }
	    return;
	} else {
	    common.logDebug('batch #' + batch + ': processed ' + howManyProcessed + ' bids');
	    processNextBidBatch(batch + 1, 0, cb);
	    return;
	}
    });
}


//
//cb(err, howManyProcessed)
//
function processBidBatch(batch, cb) {
    common.logDebug('processBidBatch: batch #' + batch);
    var bigBatch = new BN(batch);
    var batchStr = '0x' + bigBatch.toString(16, 64);
    var url = "https://api.etherscan.io/api?module=logs&action=getLogs" +
	"&fromBlock=0&toBlock=latest"                                   +
	"&address=" + CONTRACT_ADDR                                     +
	"&topic0=" + SUBMIT_BID_TOPIC0                                   +
	"&topic1=" + batchStr                                           +
	"&topic0_1_opr=and" + "&apikey=" + ETHERSCAN_APIKEY;
    common.fetch(url, function(str, err) {
	if (!str || !!err) {
	    var err = "error retreiving events: " + err;
	    console.log(err);
	    cb(err, 0);
	    return;
	}
	//typical
	//  { "status" : "1",
	//    "message": "OK",
	//    "result" : [
	//                { "address": "0xce5c603c78d047ef43032e96b5b785324f753a4f",
	//                  "topics" : [
	//                              "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
	//                              "0x000000000000000000000000b895b9a83ff10abb2c6c7030d8cf895d714d3b36",
	//                              "0x0000000000000000000000008d12a197cb00d4747a1fe03395095ce2a5cc6819"
	//                             ],
	//                  "data"   : "0x0000000000000000000000000000000000000000000000000000000000002710",
	//                  "blockNumber": "0x3c1b0a",
	//                  "timeStamp"  : "0x5952ac95",
	//                  "gasPrice"   : "0xee6b2800",
	//                  "gasUsed"    : "0xb096",
	//                  "logIndex"   : "0x29",
	//                  "transactionHash"  : "0x32c1284cdab73bcf030c2ef15ab91a2589fad2ab4b1146c49b48ee3d65fdbaac",
	//                  "transactionIndex" : "0x49"
	//                },
	//                ...
	//               ]
	//  }
	var eventsResp = JSON.parse(str);
	if (eventsResp.status == 0 && eventsResp.message == 'No records found') {
	    //this is not an err... just no bids for this batch
	    cb(null, 0);
	    return;
	}
	if (eventsResp.status != 1 || eventsResp.message != 'OK') {
	    var err = "error retreiving events: bad status (" + eventsResp.status + ", " + eventsResp.message + ")";
	    console.log(err);
	    cb(err, 0);
	    return;
	}
	var invalidBidList = [];
	for (var i = 0; i < eventsResp.result.length; ++i) {
	    //console.log(eventsResp.result[i]);
	    var topics = eventsResp.result[i].topics;
	    var data = eventsResp.result[i].data;
	    var bid = validateBidEventData(topics, data);
	    if (!!bid.bidder && INVALIDATE_ALL_BIDS) {
		console.log('processBidBatch: invalidating bid from ' + bid.bidder);
		invalidBidList.push(bid);
	    } else if (bid.szaboPrice > 0 && bid.quantity > 0) {
		bids.push(bid);
		var priceETH = bid.szaboPrice / SZABO_PER_ETH;
		console.log('processBidBatch(' + common.leftPadTo(batch, 3) + '): from ' + bid.bidder + ': ' +
			    common.leftPadTo(bid.quantity, 6) + ' tokens @ ' + common.rightPadTo(priceETH, 8) + ' ETH / token');
	    } else if (!!bid.bidder && INVALIDATE_BIDS) {
		console.log('processBidBatch: invalidating bid from ' + bid.bidder);
		invalidBidList.push(bid);
	    }
	}
	//invalidate all bids on the invalidBidList
	invalidateNext(invalidBidList, function() {
	    cb(null, eventsResp.result.length);
	});
    });
}


// validate a bid/event
//  1. decrypt msg
//  2. regenerate hash from price, quantity, secret
//  3. veryfy that hash in event == regenerated hash
//  4. verify that deposit in msg >= price * quantity
//  5. if all verificatins pass, then create and return a bid object(price quantity)
// returns bid.
//  if any checks fail then bidder is set, but price, quantity are zero
//
function validateBidEventData(topics, data) {
    //strip of '0x'
    common.logDebug('validateBidEventData: enter');
    data = data.substring(2);
    var bidder = topics[2];
    var bid = new Bid('0x' + bidder.substring(26), 0, 0);
    var depositHex = '0x' + data.substring(0x000, 0x040);
    var hashHex    = '0x' + data.substring(0x040, 0x080);
    var msgOffset  = '0x' + data.substring(0x080, 0x0c0);
    var msgLength  = '0x' + data.substring(0x0c0, 0x100);
    var encMsgHex  =        data.substring(0x100);

    //
    // 1. decrypt message
    //
    if (parseInt(msgOffset, 16) != 0x60) {
	logBadBid('validateBidEventData: msgOffset = ' + msgOffset + '; should have been 0x60');
	return(bid);
    }
    if (parseInt(msgLength, 16) != 0x100) {
	logBadBid('validateBidEventData: msgLength = ' + msgLength + '; should have been 0x100');
	return(bid);
    }
    var buf = new Buffer(encMsgHex, 'hex');
    var base64String = new Buffer(encMsgHex, 'hex').toString('base64')
    var decryptedMsg = '';
    try {
	decryptedMsg = key.decrypt(base64String);
	common.logDebug('validateBidEventData: decryptedMsg = ' + decryptedMsg);
    } catch (err) {
	logBadBid('validateBidEventData: decryption err: ' + err);
	logBadBid('msgHex = 0x' + encMsgHex);
	logBadBid('b64: ' + base64String);
	return(bid);
    }
    var secretBid = null;
    try {
	secretBid = JSON.parse(decryptedMsg);
    } catch (err) {
	logBadBid('validateBidEventData: secret bid message format err: ' + err);
	logBadBid('decryptedMsg = ' + decryptedMsg);
	return(bid);
    }
    // if bid price exceeds max, then invalidate now. price is in szabo, so max safe integer represents > 9 trillion eth
    if (parseInt(secretBid.szaboPrice) > Number.MAX_SAFE_INTEGER) {
	logBadBid('validateBidEventData: bad price in secret bid message: ' + secretBid.szaboPrice);
	logBadBid('decryptedMsg = ' + decryptedMsg);
	return(bid);
    }


    //
    // 2. regenerate hash from price, quantity, secret
    // 3. veryfy that hash in event == regenerated hash
    //
    var regeneratedHash = bidToHash(secretBid.szaboPrice, secretBid.quantity, secretBid.secret);
    if (regeneratedHash === hashHex) {
	common.logDebug('validateBidEventData: hashes match (' + regeneratedHash + ')');
    } else {
	logBadBid('validateBidEventData: hash mismatch');
	logBadBid('regeneratedHash = ' + regeneratedHash);
	logBadBid('message hash =    ' + hashHex);
	return(bid);
    }

    //
    //  4. verify that deposit in msg >= price * quantity
    //
    common.logDebug('validateBidEventData: depositHex = ' + depositHex);
    var depositWei = new BN(depositHex.substring(2), 16, 'be');
    var depositSzabo = depositWei.div(new BN(WEI_PER_SZABO)).toNumber();
    if (depositSzabo >= secretBid.szaboPrice * secretBid.quantity) {
	common.logDebug('validateBidEventData: deposit is sufficient');
    } else {
	var szaboPrice = parseInt(secretBid.szaboPrice, 16);
	var priceETH = szaboPrice / SZABO_PER_ETH;
	var quantity = parseInt(secretBid.quantity, 16);
	console.log('validateBidEventData: from ' + bid.bidder + ': ' + common.leftPadTo(quantity, 6) +
		    ' tokens @ ' + common.rightPadTo(priceETH, 8) + ' ETH / token');
	logBadBid('validateBidEventData: deposit is insufficient');
	logBadBid('have : ' + depositSzabo + ' szabo');
	logBadBid('need : ' + secretBid.szaboPrice * secretBid.quantity + ' szabo');
	return(bid);
    }
    bid.szaboPrice = parseInt(secretBid.szaboPrice, 16);
    bid.quantity = parseInt(secretBid.quantity, 16);
    common.logDebug('validateBidEventData: exit');
    return(bid);
}


// this is to regenerate a secret bid hash, given price, quantity and secret
function bidToHash(szaboPrice, quantity, secret) {
    common.logDebug('bidToHash: szaboPrice = ' + szaboPrice + ' (type = ' + typeof(szaboPrice) +
		    '), quantity = ' + quantity + ', secret = ' + secret);
    // price in szabo, so max safe integer represents > 9 trillion eth
    var szaboPriceN = parseInt(szaboPrice, 16);
    var price32 = new BN(szaboPriceN).toBuffer('be', 32);
    var quantityN = parseInt(quantity, 16);
    var quantity32 = new BN(quantityN).toBuffer('be', 32);
    var secret32 = ethUtils.setLength(secret, 32, false);
    var hash_hex = '';
    try {
	var keccak256 = new keccak(256);
	keccak256.update(secret32);
	keccak256.update(price32);
	keccak256.update(quantity32);
	hash_hex = '0x' + keccak256.digest('hex');
    } catch (err) {
	logBadBid('bidToHash: keccak256 hashing failed: ' + err);
    }
    return(hash_hex);
}


function invalidateNext(invalidBidList, cb) {
    common.logDebug('invalidateNext: length = ' + invalidBidList.length);
    if (invalidBidList.length == 0) {
	cb();
    } else {
	var bid = invalidBidList[0];
        invalidBidList.splice(0, 1);
	invalidateBid(bid, function() {
	    invalidateNext(invalidBidList, cb);
	});
    }
}

function invalidateBid(bid, cb) {
    common.logDebug('invalidateBid: bidder = ' + bid.bidder);
    var GAS_LIMIT = 50000;
    var SIZE_IS_FINNEY = true;
    var abiFcn = ether.abi_encode_disqualifyBid();
    var abiParms = ether.abi_encode_disqualifyBid_parms(bid.bidder, false);
    var txData = "0x" + abiFcn + abiParms;
    ether.send(ACCT, PRIVATE_KEY, CONTRACT_ADDR, 0, SIZE_IS_FINNEY, GAS_LIMIT, txData,
	       function(txid) {
		   common.logDebug('invalidateBid: txid = ' + txid);
		   cb();
	       });
}



function checkNextStaleBid(bids, cb) {
    common.logDebug('checkNextStaleBid: length = ' + bids.length);
    if (bids.length == 0) {
	cb();
    } else {
	var bid = bids[0];
        bids.splice(0, 1);
	checkStaleBid(bid, function(isStale) {
	    console.log('checkNextStaleBid: ' + bid.bidder + (isStale ? ' has not' : ' has') + ' executed his bid');
	    if (isStale) {
		expireBid(bid, function() {
		    checkNextStaleBid(bids, cb);
		});
	    } else {
		checkNextStaleBid(bids, cb);
	    }
	});
    }
}


//cb(isStale)
function checkStaleBid(bid, cb) {
    common.logDebug('checkStaleBid: bidder = ' + bid.bidder);
    var topic2 = '0x' + common.leftPadTo(bid.bidder.substring(2), 64, '0');
    var url = "https://api.etherscan.io/api?module=logs&action=getLogs" +
	"&fromBlock=0&toBlock=latest"                                   +
	"&address=" + CONTRACT_ADDR                                     +
	"&topic0=" + EXECUTE_BID_TOPIC0                                 +
	"&topic2=" + topic2                                             +
	"&topic0_2_opr=and" + "&apikey=" + ETHERSCAN_APIKEY;
    common.fetch(url, function(str, err) {
	if (!str || !!err) {
	    var err = "error retreiving events: " + err;
	    console.log(err);
	    cb(err, 0);
	    return;
	}
	//common.logDebug('checkStaleBid: str = ' + str);
	//typical:
	// { "status" : "1",
	//    "message":"OK",
	//    "result": [{ "address":  "0x9beec9834c1bb97597663c6415795bb4621aa8c4",
	//                 "topics" : ["0xf3f4e84227586e797977952ce09ff57aa48556bbd992e1f611cc2c3f6fb1f745",
	//                             "0x0000000000000000000000000000000000000000000000000000000000000000",
	//                             "0x0000000000000000000000008dcc341aefc83f4ed5af005adb85d21d5c175a4e"
	//                            ],
	//                 "data"   :  "0x000000000000000000000000000000000000000000000000048764804000400000000000000000000000000000000000000000000000000002456fe723f0c000",
	//                 "blockNumber" : "0x45ef8e", "timeStamp"       : "0x5a11bc6e", "gasPrice" : "0x2540be400", "gasUsed"     :"0x27423",
	//                 "logIndex"    : "0x19",     "transactionHash" : "0xdcf7c9c19d045dbb2f6df6035721b8f8622f0951be06231bfa402622dfb3ba21", "transactionIndex" : "0x27"
	//                }]
	// }
	// or:
	// {"status":"0","message":"No records found","result":[]}
	//
	var exeResp = JSON.parse(str);
	if (exeResp.status == 0 && exeResp.message == 'No records found' && exeResp.result.length == 0) {
	    //bid was not executed.... it is stale
	    cb(true);
	    return;
	}
	if (exeResp.status == 1 && exeResp.message == 'OK' && exeResp.result.length > 0) {
	    //bid was executed.... it is not stale
	    cb(false);
	    return;
	}
	console.log("error checking execution status!! (" + eventsResp.status + ", " + eventsResp.message + ")");
	cb(false);
	return;
    });
}

function expireBid(bid, cb) {
    common.logDebug('expireBid: bidder = ' + bid.bidder);
    var GAS_LIMIT = 250000;
    var SIZE_IS_FINNEY = true;
    var abiFcn = ether.abi_encode_expireBid();
    var abiParms = ether.abi_encode_expireBid_parms(bid.bidder);
    var txData = "0x" + abiFcn + abiParms;
    ether.send(ACCT, PRIVATE_KEY, CONTRACT_ADDR, 0, SIZE_IS_FINNEY, GAS_LIMIT, txData,
	       function(txid) {
		   console.log('expireBid: txid = ' + txid);
		   cb();
	       });
}


function getState(cb) {
    var url = "https://api.etherscan.io/api?module=logs&action=getLogs" +
	"&fromBlock=0&toBlock=latest"                                   +
	"&address=" + CONTRACT_ADDR                                     +
	"&topic0=" + STATE_EVENT_TOPIC0;
    myFetch(url, function(str, err) {
	if (!str || !!err) {
	    var err = "error retreiving events: " + err;
	    console.log('getState: ' + err);
	    cb(err, 0);
	}
	//typical
	//  { "status" : "1",
	//    "message": "OK",
	//    "result" : [
	//                { "address": "0xce5c603c78d047ef43032e96b5b785324f753a4f",
	//                  "topics" : [
	//                              "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
	//                              "0x000000000000000000000000b895b9a83ff10abb2c6c7030d8cf895d714d3b36",
	//                              "0x0000000000000000000000008d12a197cb00d4747a1fe03395095ce2a5cc6819"
	//                             ],
	//                  "data"   : "0x0000000000000000000000000000000000000000000000000000000000002710",
	//                  "blockNumber": "0x3c1b0a",
	//                  "timeStamp"  : "0x5952ac95",
	//                  "gasPrice"   : "0xee6b2800",
	//                  "gasUsed"    : "0xb096",
	//                  "logIndex"   : "0x29",
	//                  "transactionHash"  : "0x32c1284cdab73bcf030c2ef15ab91a2589fad2ab4b1146c49b48ee3d65fdbaac",
	//                  "transactionIndex" : "0x49"
	//                },
	//                ...
	//               ]
	//  }
	var eventsResp = JSON.parse(str);
	if (eventsResp.status == 0 && eventsResp.message == 'No records found') {
	    //this is not an err... just no events
	    cb(null, 0);
	    return;
	}
	if (eventsResp.status != 1 || eventsResp.message != 'OK') {
	    var err = "error retreiving events: bad status (" + eventsResp.status + ", " + eventsResp.message + ")";
	    console.log('getState: ' + err);
	    cb(err, 0);
	    return;
	}
	var prevState = 0;
	var prevBlockNumber = 0;
	for (var i = 0; i < eventsResp.result.length; ++i) {
	    //console.log(eventsResp.result[i]);
	    var blockNumber = parseInt(eventsResp.result[i].blockNumber, 16);
	    var state = parseInt(eventsResp.result[i].data, 16);
	    console.log('getState: block ' + blockNumber + ': state = 0x' + state.toString(16));
	    //if state changed multiple times in a single block, then take the most complex state
	    if (blockNumber > prevBlockNumber || (blockNumber == prevBlockNumber && state > prevState)) {
		prevState = state;
		prevBlockNumber = blockNumber;
	    }
	}
	cb(null, prevState);
    });
}
