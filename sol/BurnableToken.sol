pragma solidity ^0.4.18;

/**
 *
 * Version D
 * @author  Pratyush Bhatt <MysticMonsoon@protonmail.com>
 *
 * Overview:
 * This is an implimentation of a `burnable` token. The tokens do not pay any dividends; however if/when tokens
 * are `burned`, the burner gets a share of whatever funds the contract owns at that time. No provision is made
 * for how tokens are sold; all tokens are initially credited to the contract owner. There is a provision to
 * establish a single `restricted` account. The restricted account can own tokens, but cannot transfer them or
 * burn them until after a certain date. . There is also a function to burn tokens without getting paid. This is
 * useful, for example, if the sale-contract/owner wants to reduce the supply of tokens.
 *
 */
import './SafeMath.sol';
import './iBurnableToken.sol';

contract BurnableToken is iBurnableToken, SafeMath {

  event PaymentEvent(address indexed from, uint amount);
  event TransferEvent(address indexed from, address indexed to, uint amount);
  event ApprovalEvent(address indexed from, address indexed to, uint amount);
  event BurnEvent(address indexed from, uint count, uint value);

  string  public symbol;
  string  public name;
  bool    public isLocked;
  uint    public decimals;
  uint    public restrictUntil;                              //vesting for developer tokens
  uint           tokenSupply;                                //can never be increased; but tokens can be burned
  address public owner;
  address public restrictedAcct;                             //no transfers from this addr during vest time
  mapping (address => uint) balances;
  mapping (address => mapping (address => uint)) approvals;  //transfer approvals, from -> to


  modifier ownerOnly {
    require(msg.sender == owner);
    _;
  }

  modifier unlockedOnly {
    require(!isLocked);
    _;
  }

  modifier preventRestricted {
    require((msg.sender != restrictedAcct) || (now >= restrictUntil));
    _;
  }

  //this is to protect from short-address attack. use this to verify size of args, especially when an address arg preceeds
  //a value arg. see: https://www.reddit.com/r/ethereum/comments/63s917/worrysome_bug_exploit_with_erc20_token/dfwmhc3/
  modifier onlyPayloadSize(uint size) {
    assert(msg.data.length >= size + 4);
    _;
  }

  //
  //constructor
  //
  function BurnableToken() public {
    owner = msg.sender;
  }


  //
  // ERC-20
  //

  function totalSupply() public constant returns (uint supply) { supply = tokenSupply; }

  function transfer(address _to, uint _value) public preventRestricted onlyPayloadSize(2*32) returns (bool success) {
    //if token supply was not limited then we would prevent wrap:
    //if (balances[msg.sender] >= _value && balances[_to] + _value > balances[_to])
    if (balances[msg.sender] >= _value && _value > 0) {
      balances[msg.sender] -= _value;
      balances[_to] += _value;
      TransferEvent(msg.sender, _to, _value);
      return true;
    } else {
      return false;
    }
  }


  function transferFrom(address _from, address _to, uint _value) onlyPayloadSize(3*32) public returns (bool success) {
    //if token supply was not limited then we would prevent wrap:
    //if (balances[_from] >= _value && approvals[_from][msg.sender] >= _value && balances[_to] + _value > balances[_to])
    if (balances[_from] >= _value && approvals[_from][msg.sender] >= _value && _value > 0) {
      balances[_from] -= _value;
      balances[_to] += _value;
      approvals[_from][msg.sender] -= _value;
      TransferEvent(_from, _to, _value);
      return true;
    } else {
      return false;
    }
  }


  function balanceOf(address _owner) public constant returns (uint balance) {
    balance = balances[_owner];
  }


  function approve(address _spender, uint _value) public preventRestricted onlyPayloadSize(2*32) returns (bool success) {
    approvals[msg.sender][_spender] = _value;
    ApprovalEvent(msg.sender, _spender, _value);
    return true;
  }


  function allowance(address _owner, address _spender) public constant returns (uint remaining) {
    return approvals[_owner][_spender];
  }


  //
  // END ERC20
  //


  //
  // default payable function.
  //
  function () public payable {
    PaymentEvent(msg.sender, msg.value);
  }

  function initTokenSupply(uint _tokenSupply, uint _decimals) public ownerOnly {
    require(tokenSupply == 0);
    tokenSupply = _tokenSupply;
    balances[owner] = tokenSupply;
    decimals = _decimals;
  }

  function setName(string _name, string _symbol) public ownerOnly {
    name = _name;
    symbol = _symbol;
  }

  function lock() public ownerOnly {
    isLocked = true;
  }

  function setRestrictedAcct(address _restrictedAcct, uint _restrictUntil) public ownerOnly unlockedOnly {
    restrictedAcct = _restrictedAcct;
    restrictUntil = _restrictUntil;
  }

  function tokenValue() constant public returns (uint _value) {
    _value = this.balance / tokenSupply;
  }

  function valueOf(address _owner) constant public returns (uint _value) {
    _value = (this.balance * balances[_owner]) / tokenSupply;
  }

  function burnTokens(uint _burnCount) public preventRestricted {
    if (balances[msg.sender] >= _burnCount && _burnCount > 0) {
      uint _value = safeMul(this.balance, _burnCount) / tokenSupply;
      tokenSupply = safeSub(tokenSupply, _burnCount);
      balances[msg.sender] = safeSub(balances[msg.sender], _burnCount);
      msg.sender.transfer(_value);
      BurnEvent(msg.sender, _burnCount, _value);
    }
  }

  function unPaidBurnTokens(uint _burnCount) public preventRestricted {
    if (balances[msg.sender] >= _burnCount && _burnCount > 0) {
      tokenSupply = safeSub(tokenSupply, _burnCount);
      balances[msg.sender] = safeSub(balances[msg.sender], _burnCount);
      BurnEvent(msg.sender, _burnCount, 0);
    }
  }

  //for debug
  //only available before the contract is locked
  function haraKiri() public ownerOnly unlockedOnly {
    selfdestruct(owner);
  }

}
