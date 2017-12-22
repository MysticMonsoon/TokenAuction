pragma solidity ^0.4.18;

//Burnable Token interface

import './iERC20Token.sol';

contract iBurnableToken is iERC20Token {
  function burnTokens(uint _burnCount) public;
  function unPaidBurnTokens(uint _burnCount) public;
}
