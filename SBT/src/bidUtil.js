
var NodeRSA = require('node-rsa');
var ether = require('./ether');
var ethUtils = require('ethereumjs-util');
var Buffer = require('buffer/').Buffer;
var BN = require("bn.js");
const keccak = require('keccakjs');

//YOU NEED TO SET THIS
var CONTRACT_ADDR = "";

var ICO_AUCTION_NAME = "Token auction";
var BID_EVENT_TOPIC0 = "0xe15b694b705acb702334150b898bb2a2646b7bd2748a22f26c36e6ba7cb89f1c";
var STATE_EVENT_TOPIC0 = "0xc4d1978aca5dbd557298da69c7a31a5dec628dce416e9a721f63665722865502";
var SZABO_PER_ETH = 1000000;
var MAX_ETH_PRICE = 100;
var MIN_ETH_PRICE = 0.000001;
var DEPOSIT_RESOLUTION = 1000000;
var MAX_QUANTITY = 100000000;
var MIN_QUANTITY = 1;
//submitSecretBid gas = 93869, 93805, 108805
var GAS_LIMIT = 200000;
var GAS_ALLOWANCE_SZABO = 5000;
//
// auction state (from contract events)
var AUCTION_START_EVENT = 0x01;
var AUCTION_END_EVENT   = 0x02;
var SALE_START_EVENT    = 0x04;
var SALE_END_EVENT      = 0x08;
//
var myWeb3              = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('content loaded');
    checkForMetaMask(false, function(err, w3) {
	myWeb3 = w3;
	if (!!err)
	    alert(err);
	else
	    bidUtil.main();
    });
}, false);


var bidUtil = module.exports = {
    main: function() {
	console.log('bidUtil.main');
	var genBidFormDiv = document.getElementById('genBidFormDiv');
	var exeBidFormDiv = document.getElementById('exeBidFormDiv');
	getState(function(err, state) {
	    if (genBidFormDiv) {
		if (!(state & AUCTION_START_EVENT))
		    alert("The " + ICO_AUCTION_NAME + " has not started yet!");
		else if (state & AUCTION_END_EVENT)
		    alert("The " + ICO_AUCTION_NAME + " has already ended!");
		else
		    makeGenBidForm();
	    }
	    if (exeBidFormDiv) {
		if (!(state & AUCTION_START_EVENT))
		    alert("The " + ICO_AUCTION_NAME + " has not started yet!");
		else if (!(state & AUCTION_END_EVENT))
		    alert("The " + ICO_AUCTION_NAME + " has not ended yet. You cannot execute your bid until the end of the auction period.");
		else if (!(state & SALE_START_EVENT))
		    alert("The " + ICO_AUCTION_NAME +
			  " sale period has not started yet. Since the auction has ended, the sale period should begin shortly. Please check back soon.");
		else if (state & SALE_END_EVENT)
		    alert("The " + ICO_AUCTION_NAME + " sale period has ended. Any bids that have not been executed can be be 'expired' for a partial refund");
		else
		    makeExeBidForm();
	    }
	});
    },
};


var auctioneerPubkey =
    '-----BEGIN PUBLIC KEY-----' +
'THE AUCTOINEERS REAL PUBLIC KEY SHOULD BE HERE' +
'-----END PUBLIC KEY-----';




//
// generate a secret word for use in generating a secret bid hash. the secret word
// can be any random word -- but here we auto-generate the word by signing an arbitrary
// message with the user's private key. the important points is that the word is
// generated deterministically (so that we can re-generate it when we reveal the bid).
//
function secretFromAcct(acct, cb) {
    var msg = "This is an arbitrary message. By signing it you will create a secret 'Salt Code.'\n\n\
He no longer dreamed of storms, nor of women, nor of great occurrences, nor of great fish, nor fights, \
nor contests of strength, nor of his wife. He only dreamed of places now and of the lions on the beach.";
    var hexMsg = ethUtils.bufferToHex(msg);
    myWeb3.personal.sign(hexMsg, myWeb3.eth.accounts[0], function(err, sign) {
	if (!!err) {
	    console.log('secretFromAcct: error signing arbitrary message. err = ' + err);
	    alert('Unable to generate secret: ' + err);
	    cb(null);
	} else {
	    var secret = sign.substring(10, 18);
	    console.log('secret = ' + secret);
	    cb(secret);
	}
    });
}


//
// create a secretBid object containing:
//  secret
//  price (szabo / whole token)
//  quantity (of whole tokens)
//  hash of secret, price (szabo / whole token), quantity (of whole tokens)
//  gpg encrypted message containing secret, price (szabo / whole token), quantity (of whole tokens)
//
// everything is hex encoded
//
function SecretBid(szaboPrice, quantity, secret) {
  try {
      var szaboPriceBN = new BN(szaboPrice);
      console.log('SecretBid: szaboPriceBN = ' + szaboPriceBN.toString());
      var priceBuffer = szaboPriceBN.toArrayLike(Buffer, 'be');
      var quantityBuffer = new BN(quantity).toArrayLike(Buffer, 'be');
      this.secretHex = ethUtils.bufferToHex(secret);
      this.priceHex = ethUtils.bufferToHex(priceBuffer);
      this.quantityHex = ethUtils.bufferToHex(quantityBuffer);
      var msgInfo = {
	  secret:     this.secretHex,
	  szaboPrice: this.priceHex,
	  quantity:   this.quantityHex
      };
      var msgJSON = JSON.stringify(msgInfo);
      console.log('SecretBid: msgJSON = ' + msgJSON);
      //
      var secret32   = ethUtils.setLength(secret, 32, false);
      var price32    = ethUtils.setLength(priceBuffer, 32, false);
      var quantity32 = ethUtils.setLength(quantityBuffer, 32, false);
      var keccak256 = new keccak(256);
      keccak256.update(secret32);
      keccak256.update(price32);
      keccak256.update(quantity32);
      this.hashHex = '0x' + keccak256.digest('hex');
      //
      var pubkey = new NodeRSA(auctioneerPubkey);
      var encB64 = pubkey.encrypt(msgJSON, 'base64');
      this.encMsgHex = '0x' + (new Buffer(encB64, 'base64').toString('hex'));
      console.log('encryped b64 = ' + encB64 + ', length = ' + encB64.length);
      console.log('encryped hex = ' + this.encMsgHex + ', length: ' + this.encMsgHex.length);
  } catch (err) {
      alert('Unable to generate bid: ' + err);
  }
}


//
// make the generate/submit secret bid form
//
function makeGenBidForm() {
    var genBidFormDiv = document.getElementById('genBidFormDiv');
    genBidFormDiv.className = 'formtable';
    var form = document.createElement('form');
    form.action = 'javascript:;';
    //price
    var price = document.createElement('input');
    addInputToFormTable("Price (Maximum price per token, in ETH):", 'td', price, 'td', form);
    //quantity
    var quantity = document.createElement('input');
    addInputToFormTable("Quantity (Number of tokens to purchase at that price):", 'td', quantity, 'td', form);
    //generate
    var generateButton = document.createElement('button');
    generateButton.className = 'formtable';
    var generateButton_text = document.createTextNode("Generate Hash");
    generateButton.appendChild(generateButton_text);
    addInputToFormTable(' ', 'td', generateButton, 'td', form);
    genBidFormDiv.appendChild(form);
    //
    var genBidResultsDiv = document.getElementById('genBidResultsDiv');
    genBidResultsDiv.className = 'resultstable';
    var resultsForm = document.createElement('form');
    resultsForm.action = 'javascript:;';
    var salt_text = document.createElement('input');
    salt_text.readOnly = true;
    salt_text.size = '7';
    salt_text.disabled = true;
    addInputToFormTable("Salt Code:", 'td', salt_text, 'td', resultsForm);
    var hash_text = document.createElement('input');
    hash_text.readOnly = true;
    hash_text.size = '62';
    hash_text.disabled = true;
    addInputToFormTable("Bid Hash:", 'td', hash_text, 'td', resultsForm);
    var msg_text = document.createElement('textarea');
    msg_text.readOnly = true;
    msg_text.cols = '100';
    msg_text.rows = '5';
    msg_text.disabled = true;
    addInputToFormTable("Encrypted Bid Message:", 'tdvc', msg_text, 'td', resultsForm);
    var deposit_text = document.createElement('input');
    deposit_text.readOnly = true;
    addInputToFormTable("Deposit Amount:", 'td', deposit_text, 'td', resultsForm);
    genBidResultsDiv.appendChild(resultsForm);
    var submitBidButton = document.getElementById('submitBidButton');
    submitBidButton.className = 'formtable';
    submitBidButton.disabled = true;
    var submitStatusDiv = document.getElementById('submitStatusDiv');
    submitStatusDiv.className = 'finalresultstable';
    //
    var secretBid = null;
    var szaboPrice = -1;
    var intQuantity = -1;
    var depositETH = -1;
    generateButton.addEventListener('click', function() {
	console.log('got generate... price = ' + price.value + ', quantity = ' + quantity.value);
	//in case we are retrying an aold attempt
	clearStatusDiv(submitStatusDiv);
	var floatPrice = parseFloat(price.value);
	if (isNaN(floatPrice) || floatPrice > MAX_ETH_PRICE || floatPrice < MIN_ETH_PRICE) {
	  alert('Price must be between ' + MIN_ETH_PRICE + ' and ' + MAX_ETH_PRICE + ' ETH per token');
	  return;
	}
	floatPrice = parseFloat(Math.round(floatPrice * DEPOSIT_RESOLUTION)) / DEPOSIT_RESOLUTION;
	price.value = floatPrice.toString(10);
	intQuantity = parseInt(quantity.value, 10);
	if (isNaN(intQuantity) || intQuantity > MAX_QUANTITY || intQuantity < MIN_QUANTITY) {
	    alert('Quantity must be between ' + MIN_QUANTITY + ' and ' + MAX_QUANTITY);
	    return;
	}
	quantity.value = parseFloat(intQuantity).toFixed(3);
	szaboPrice = parseInt(floatPrice * SZABO_PER_ETH);
	checkForMetaMask(true, function(err, w3) {
	    myWeb3 = w3;
	    if (!!err) {
		alert(err);
		return;
	    }
	    secretFromAcct(myWeb3.eth.accounts[0], function(secret) {
		if (!!secret) {
		    secretBid = new SecretBid(szaboPrice, intQuantity, secret);
		    if (!!secretBid && !!secretBid.encMsgHex) {
			salt_text.value = secret;
			hash_text.value = secretBid.hashHex;
			msg_text.value = secretBid.encMsgHex;
			console.log('floatPrice = ' + floatPrice + ', intQuantity = ' + intQuantity);
			depositETH = Math.round(floatPrice * intQuantity * DEPOSIT_RESOLUTION) / DEPOSIT_RESOLUTION;
			deposit_text.value = depositETH + ' ETH';
			submitBidButton.disabled = false;
		    }
		}
	      });
	  });
      });
    //
    submitBidButton.addEventListener('click', function() {
	console.log('got submit...');
	//TODO: check that bid not already submitted from this acct...
	var depositSzabo = szaboPrice * intQuantity;
	console.log('depositSzabo = ' + depositSzabo);
	var abiDepositFcn = ether.abi_encode_depositSecretBid();
	var abiParms = ether.abi_encode_depositSecretBid_parms(secretBid.hashHex, secretBid.encMsgHex);
        var submitData = "0x" + abiDepositFcn + abiParms;
	submitBid(submitData, submitStatusDiv, depositSzabo, submitBidButton);
    });
}


//
// actually submit the bid
//
function submitBid(submitData, submitStatusDiv, depositSzabo, submitBidButton) {
    ether.getBalance(myWeb3, 'szabo', function(balance) {
	var szaboBalance = parseInt(balance);
	console.log('szaboBalance = ' + szaboBalance);
	if (szaboBalance <= depositSzabo + GAS_ALLOWANCE_SZABO) {
	    var balanceETH = (szaboBalance / SZABO_PER_ETH).toFixed(6);
	    var depositETH = (depositSzabo / SZABO_PER_ETH).toFixed(6);
	    var gasEth = (GAS_ALLOWANCE_SZABO / SZABO_PER_ETH).toFixed(6);
	    alert('You don\'t have enough ETH in this account. You only have ' + balanceETH + ' ETH. But Your desposit amount is ' + depositETH +
		  ' ETH; and you also must have at least ' + gasEth + ' ETH to cover gas costs.');
	    return;
	}
	console.log('about to tx: ' + submitData);
	submitBidButton.disabled = true;
	if (!!CONTRACT_ADDR) {
	    ether.send(myWeb3, CONTRACT_ADDR, depositSzabo, 'szabo', submitData, GAS_LIMIT, function(err, submitTXID) {
		if (!!err) {
		    alert('Error submitting bid!\n\n' + err);
		} else {
		    console.log('sent depositSecretBid to contract; err = ' + err + ', txid: ' + submitTXID);
		    waitForTXID(submitTXID, 'submit secret bid', submitStatusDiv, function(err) {
		    });
		}
	    });
	}
    });
}


//
// make the execute bid form
//
function makeExeBidForm() {
    console.log('makeExeBidForm: enter');
    var exeBidFormDiv = document.getElementById('exeBidFormDiv');
    exeBidFormDiv.className = 'formtable';
    var form = document.createElement('form');
    form.action = 'javascript:;';
    //price
    var price = document.createElement('input');
    addInputToFormTable("Price (Maximum price per token, in ETH):", 'td', price, 'td', form);
    //quantity
    var quantity = document.createElement('input');
    addInputToFormTable("Quantity (Number of tokens to purchase at that price):", 'td', quantity, 'td', form);
    //generate
    var generateButton = document.createElement('button');
    generateButton.className = 'formtable';
    var generateButton_text = document.createTextNode("Get Salt Code");
    generateButton.appendChild(generateButton_text);
    addInputToFormTable(' ', 'td', generateButton, 'td', form);
    exeBidFormDiv.appendChild(form);
    //
    var exeBidResultsDiv = document.getElementById('exeBidResultsDiv');
    exeBidResultsDiv.className = 'resultstable';
    var resultsForm = document.createElement('form');
    resultsForm.action = 'javascript:;';
    var salt_text = document.createElement('input');
    salt_text.readOnly = true;
    salt_text.size = '7';
    salt_text.disabled = true;
    addInputToFormTable("Salt Code:", 'td', salt_text, 'td', resultsForm);
    var hash_text = document.createElement('input');
    hash_text.readOnly = true;
    hash_text.size = '62';
    hash_text.disabled = true;
    addInputToFormTable("Bid Hash:", 'td', hash_text, 'td', resultsForm);
    exeBidResultsDiv.appendChild(resultsForm);
    var executeBidButton = document.getElementById('executeBidButton');
    executeBidButton.className = 'formtable';
    executeBidButton.disabled = true;
    //
    var executeStatusDiv = document.getElementById('executeStatusDiv');
    executeStatusDiv.className = 'finalresultstable';
    var refundStatusDiv = document.getElementById('refundStatusDiv');
    refundStatusDiv.className = 'finalresultstable';
    //
    var secretBid = null;
    var szaboPrice = -1;
    var intQuantity = -1;
    var depositETH = -1;
    var sig = null;
    generateButton.addEventListener('click', function() {
	console.log('got generate... price = ' + price.value + ', quantity = ' + quantity.value);
	//in case we are retrying an aold attempt
	clearStatusDiv(executeStatusDiv);
	clearStatusDiv(refundStatusDiv);
	var floatPrice = parseFloat(price.value);
	if (isNaN(floatPrice) || floatPrice > MAX_ETH_PRICE || floatPrice < MIN_ETH_PRICE) {
	    alert('Price must be between ' + MIN_ETH_PRICE + ' and ' + MAX_ETH_PRICE + ' ETH per token');
	    return;
	}
	floatPrice = parseFloat(Math.round(floatPrice * DEPOSIT_RESOLUTION)) / DEPOSIT_RESOLUTION;
	price.value = floatPrice.toString(10);
	intQuantity = parseInt(quantity.value, 10);
	if (isNaN(intQuantity) || intQuantity > MAX_QUANTITY || intQuantity < MIN_QUANTITY) {
	    alert('Quantity must be between ' + MIN_QUANTITY + ' and ' + MAX_QUANTITY);
	    return;
	}
	quantity.value = parseFloat(intQuantity).toFixed(3);
	szaboPrice = parseInt(floatPrice * SZABO_PER_ETH);
	checkForMetaMask(true, function(err, w3) {
	    myWeb3 = w3;
	    if (!!err) {
		alert(err);
		return;
	    }
	    secretFromAcct(myWeb3.eth.accounts[0], function(secret) {
		if (!!secret) {
		  secretBid = new SecretBid(szaboPrice, intQuantity, secret);
		  if (!!secretBid && !!secretBid.encMsgHex) {
		    salt_text.value = secret;
		    hash_text.value = secretBid.hashHex;
		    //depositETH = Math.round(floatPrice * intQuantity * DEPOSIT_RESOLUTION) / DEPOSIT_RESOLUTION;
		    executeBidButton.disabled = false;
		  }
		}
	      });
	  });
      });
    //
    executeBidButton.addEventListener('click', function() {
	console.log('got execute...');
	//if bid has already ben executed, then the execute fcn is a nop
	var abiExecuteFcn = ether.abi_encode_executeBid();
	var abiParms = ether.abi_encode_executeBid_parms(secretBid.secretHex, secretBid.priceHex, secretBid.quantityHex);
        var executeData = '0x' + abiExecuteFcn + abiParms;
	var abiRefundFcn = ether.abi_encode_withdrawRefund();
	var refundData = '0x' + abiRefundFcn;
	executeBidReqRefund(executeData, executeStatusDiv, refundData, refundStatusDiv, executeBidButton);
    });
}


//
// actually execute the bid; then request a refund
//
function executeBidReqRefund(executeData, executeStatusDiv, refundData, refundStatusDiv, executeBidButton) {
    ether.getBalance(myWeb3, 'szabo', function(balance) {
	var szaboBalance = parseInt(balance);
	console.log('szaboBalance = ' + szaboBalance);
	if (szaboBalance <= 2 * GAS_ALLOWANCE_SZABO) {
	    var balanceETH = (szaboBalance / SZABO_PER_ETH).toFixed(6);
	    var gasEth = (2 * GAS_ALLOWANCE_SZABO / SZABO_PER_ETH).toFixed(6);
	    alert('You don\'t have enough ETH in this account. You only have ' + balanceETH + ' ETH. But you must have at least ' + gasEth +
		  ' ETH to cover gas costs.');
	    return;
	}
	console.log('about to tx: ' + executeData);
	executeBidButton.disabled = true;
	if (!!CONTRACT_ADDR) {
	  ether.send(myWeb3, CONTRACT_ADDR, 0, 'szabo', executeData, GAS_LIMIT, function(err, executeTXID) {
	      if (!!err) {
		alert('Error executing bid!\n\n' + err);
	      } else {
		console.log('sent executeBid to contract; err = ' + err + ', txid: ' + executeTXID);
		waitForTXID(executeTXID, 'execute bid', executeStatusDiv, function(err) {
		    if (!err) {
		      ether.send(myWeb3, CONTRACT_ADDR, 0, 'szabo', refundData, GAS_LIMIT, function(err, refundTXID) {
			  if (!!err) {
			    alert('Error requesting refund!\n\n' + err);
			  } else {
			    console.log("sent withdrawRefund to contract; txid: " + refundTXID);
			    waitForTXID(refundTXID, 'withdraw refund', refundStatusDiv, function(err) {
			    });
			  }
			});
		    }
		});
	      }
	    });
	}
    });
}


function waitForTXID(txid, desc, statusDiv, callback) {
    var statusCtr = 0;
    var statusText = document.createTextNode('No status yet...');
    //status div starts out hidden
    statusDiv.style.display = "block";
    statusDiv.appendChild(statusText);
    var link = document.createElement('a');
    link.href = 'https://etherscan.io/tx/' + txid;
    link.innerHTML = "<h2>View transaction</h2>";
    link.target = '_blank';
    link.disabled = false;
    statusDiv.appendChild(link);
    var timer = setInterval(function() {
	statusText.textContent = 'Waiting for ' + desc + ' transaction: ' + ++statusCtr + ' seconds...';
	if ((statusCtr & 0xf) == 0) {
	    myWeb3.eth.getTransactionReceipt(txid, function(err, receipt) {
		if (!!err || !!receipt) {
		    if (!err && !!receipt && receipt.status == 0)
			err = "Transaction Failed with REVERT opcode";
		    statusText.textContent = (!!err) ? 'Error in ' + desc + ' transaction: ' + err : desc + ' transaction succeeded!';
		    console.log('transaction is in block ' + (!!receipt ? receipt.blockNumber : 'err'));
		    //statusText.textContent = desc + ' transaction succeeded!';
		    clearInterval(timer);
		    callback(err);
		    return;
		}
	    });
	}
    }, 1000);
}


function addInputToFormTable(prompt, promptClass, input, inputClass, f) {
    var d;
    var s;
    var t;
    (d = document.createElement("div")).className = 'tr';
    if (!!prompt) {
	(s = document.createElement("span")).className = promptClass;
	t = document.createTextNode(prompt);
	s.appendChild(t);
	d.appendChild(s);
    }
    if (!!input) {
	(s = document.createElement("span")).className = inputClass;
	s.appendChild(input);
	d.appendChild(s);
    }
    f.appendChild(d);
}


function clearStatusDiv(statusDiv) {
    while (statusDiv.hasChildNodes()) {
	statusDiv.removeChild(statusDiv.lastChild);
    }
    statusDiv.style.display = "none";
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


//
// general purpose utils
//

//
// if requireAcct, then not only must mm be installed, but also an acct must be unlocked
// callback(err, myWeb3)
//
function checkForMetaMask(requireAcct, cb) {
    var myWeb3 = null;
    if (typeof web3 === 'undefined') {
	cb('You must enable the MetaMask plugin to use this utility', null);
    } else {
	myWeb3 = new Web3(web3.currentProvider);
	console.log('found metamask');
	web3.version.getNetwork((err, netId) => {
	    if (!!err)
		cb(err,null)
	    else if (netId != "1")
		cb('MetaMask must be set to mainnet!', null);
	    else if (!!requireAcct && !web3.eth.accounts[0])
		cb('To use this utility, a MetaMask account must be unlocked', null);
	    else
		cb(null, myWeb3);
	});
    }
}

function myFetch(url, callback) {
    var timeout = false;
    var complete = false;
    var fetch_timer = setTimeout(function() {
	timeout = true;
	if (complete == true) {
	    return;
	} else {
	    console.log("myFetch: timeout retrieving " + url);
		callback("", "timeout");
	}
    }, 15000);
    console.log('myFetch: fetching ' + url);
	var request = new Request(url);
    fetch(request, { mode: 'cors'} ).then(function(resp) {
	console.log('myFetch: got resp = ' + resp + ', status = ' + resp.status + ', (' + resp.statusText + ')');
	    clearTimeout(fetch_timer);
	complete = true;
	    if (timeout == true) {
		console.log("myFetch: fetch returned after timeout! url = " + url);
		return;
	    }
	if (resp.ok) {
	    resp.text().then(function(str) {
		    callback(str, "");
	    });
	} else {
	    console.log("myFetch: got err = " + resp.blob());
	    callback("", "unknown");
	}
    }).catch(function(error) {
	console.log("myFetch: exeption = " + error);
	    complete = true;
	callback("", error);
    });
}
