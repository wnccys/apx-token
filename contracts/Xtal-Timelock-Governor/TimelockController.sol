// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract TimelockControl is TimelockController {
    /**
     * @dev Constructor to initialize the Timelock.
     * @param minDelay The minimum time (in seconds) a proposal must wait before execution.
     * @param proposers List of addresses that can schedule operations (usually just the Governor).
     * @param executors List of addresses that can execute operations (usually address(0)).
     * @param admin Address that can grant/revoke roles (usually the deployer, initially).
    */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}