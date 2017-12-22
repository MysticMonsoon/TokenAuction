
//
// fcns related to interaction w/ auction contract
//
var ethUtils = require('ethereumjs-util');
var ethtx = require('ethereumjs-tx');
var ethabi = require('ethereumjs-abi');
var Buffer = require('buffer/').Buffer;
var BN = require("bn.js");

var ether = module.exports = {


    abi_encode_depositSecretBid: function() {
	//bytes32 hash, bytes message
	encoded = ethabi.methodID('depositSecretBid', [ 'bytes32', 'bytes' ]).toString('hex');
	return(encoded);
    },

    abi_encode_depositSecretBid_parms: function(hash, message) {
	if (hash.startsWith('0x'))
	    hash = hash.substring(2);
	var bytes = ethUtils.toBuffer(message);
	encoded = ethabi.rawEncode([ 'bytes32', 'bytes' ], [ new BN(hash, 16), bytes ] ).toString('hex');
	return(encoded);
    },

    abi_encode_executeBid: function() {
	//uint256 _secret, uint256 _price, uint256 _quantity
	encoded = ethabi.methodID('executeBid', [ 'uint256', 'uint256', 'uint256' ]).toString('hex');
	return(encoded);
    },

    abi_encode_executeBid_parms: function(secret, price, quantity) {
	console.log('ether.abi_encode_executeBid_parms: secret = ' + secret + ' (' + typeof(secret) + ')');
	console.log('price = ' + price + ' (' + typeof(price) + ') quantity = ' + quantity + ' (' + typeof(quantity) + ')');
	if (secret.startsWith('0x'))
	    secret = secret.substring(2);
	if (price.startsWith('0x'))
	    price = price.substring(2);
	if (quantity.startsWith('0x'))
	    quantity = quantity.substring(2);
	encoded = ethabi.rawEncode([ 'uint256', 'uint256', 'uint256' ],
				   [ new BN(secret, 16),
				     new BN(price, 16),
				     new BN(quantity, 16)
				   ] ).toString('hex');
	return(encoded);
    },

    abi_encode_withdrawRefund: function() {
	//no parms
	encoded = ethabi.methodID('withdrawRefund', []).toString('hex');
	return(encoded);
    },


    //
    // units: 'szabo' | 'finney' | 'ether'
    //
    getBalance: function(web3, units, callback) {
	web3.eth.getBalance(web3.eth.accounts[0], function (err, balance) {
	    console.log('get_balance bal = ' + balance.toString() + ', type = ' + typeof(balance));
	    callback(web3.fromWei(balance, units).toString());
	});
    },


    //
    // units: 'szabo' | 'finney' | 'ether'
    //
    send: function(web3, to_addr, size, units, data, gasLimit, callback) {
	var tx = {};
	tx.from = web3.eth.accounts[0];
	tx.value = web3.toWei(size, units);
	tx.to = to_addr,
	tx.data = data;
	tx.gas = gasLimit;
	console.log('calling sendTransaction');
	web3.eth.sendTransaction(tx, callback)
    },

};
