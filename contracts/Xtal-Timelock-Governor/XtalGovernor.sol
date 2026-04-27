// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

// The Lifecycle Flow
// Creation: propose(...) creates a proposalId.
// Snapshot: At block.number + votingDelay(), the voting power is "frozen."
// Voting: Holders call castVote(...).
// Success: If Against < For AND For > Quorum.
// Queue: queue(...) sends the instructions to the Timelock.
// Execute: execute(...) runs the code after the Timelock delay.

contract XtalGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint48 _initialVotingDelay, // Pass this in
        uint32 _initialVotingPeriod  // Pass this in
    )
        Governor("MyGovernor")
        GovernorSettings(_initialVotingDelay, _initialVotingPeriod, 0)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(_timelock)
    {
    }

    // --- Overrides required by Solidity / OpenZeppelin v5 ---

    // This is the "Cooling Off" period. It’s the delay between when a proposal is submitted and when people can start voting.
    // This prevents people from seeing a proposal and immediately buying/borrowing tokens to manipulate the result (Flash Loan protection).
    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    // How long the voting windows stays open. Once this time passes, the "Snapshot" is finalized.
    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    // Returns the minimum number of "YES" votes required for a proposal to be valid. If only 1% of people vote, the proposal fails even if they all said yes.
    function quorum(uint256 blockNumber) public view override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }

    // This is the state machine. It checks if the proposal is Pending, Active, Canceled, Defeated, Succeeded, Queued, Expired, or Executed.
    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    // The "Barrier to Entry." This is the minimum amount of tokens (or voting weight) an address must have just to create a proposal. It prevents spam.
    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function supportsInterface(bytes4 interfaceId) public view override(Governor) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // This returns true because you are using a Timelock. It tells the Governor: "Hey, even if we win the vote, don't execute it yet. Send it to the Timelock first."
    function proposalNeedsQueuing(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }

    // This is the hand-off. It encodes the proposal data and tells the Timelock: "Start the countdown for these transactions."
    function _queueOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint48)
    {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    // After the Timelock delay expires, this function is called to actually trigger the transactions.
    // Since you're using GovernorTimelockControl, this function is basically a wrapper that asks the Timelock to call the targets.
    function _executeOperations(uint256 proposalId, address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal override(Governor, GovernorTimelockControl)
    {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(address[] memory targets, uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash)
        internal override(Governor, GovernorTimelockControl) returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    // Returns the address that is allowed to execute proposals. In your case, it will be the Timelock contract address.
    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}