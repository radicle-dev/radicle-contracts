// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.5;
pragma experimental ABIEncoderV2;

import "./libraries/ReceiverWeights.sol";
import "hardhat/console.sol";

contract ReceiverWeightsTest {
    bool internal constant PRINT_GAS_USAGE = false;

    using ReceiverWeightsImpl for ReceiverWeights;

    /// @dev The tested data structure
    ReceiverWeights private receiverWeights;
    /// @dev The values returned from the iteration after the last `setWeights` call
    ReceiverWeightIterated[] private receiverWeightsIterated;
    /// @notice The change of sum of the stored receiver weights due to the last `setWeights` call
    int256 public weightSumDelta;

    struct ReceiverWeightIterated {
        address receiver;
        uint32 weight;
    }

    function setWeights(ReceiverWeightIterated[] calldata weights) external {
        weightSumDelta = 0;
        uint256 totalGasUsed = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            address setReceiver = weights[i].receiver;
            uint32 newWeightReceiver = weights[i].weight;
            uint256 gasUsed = gasleft();
            uint32 oldWeightReceiver = receiverWeights.setWeight(setReceiver, newWeightReceiver);
            gasUsed -= gasleft();
            totalGasUsed += gasUsed;
            weightSumDelta -= oldWeightReceiver;
            weightSumDelta += newWeightReceiver;
            if (PRINT_GAS_USAGE)
                console.log(
                    "Setting for receiver %s weight %d with gas used %d",
                    setReceiver,
                    newWeightReceiver,
                    gasUsed
                );
        }
        delete receiverWeightsIterated;
        address receiver = ReceiverWeightsImpl.ADDR_ROOT;
        address hint = ReceiverWeightsImpl.ADDR_ROOT;
        uint256 iterationGasUsed = 0;
        while (true) {
            // Each step of the non-pruning iteration should yield the same items
            (address receiverIter, address hintIter, uint32 weightIter) =
                receiverWeights.nextWeight(receiver, hint);
            uint32 weight;
            uint256 gasLeftBefore = gasleft();
            (receiver, hint, weight) = receiverWeights.nextWeightPruning(receiver, hint);
            iterationGasUsed += gasLeftBefore - gasleft();
            require(receiverIter == receiver, "Non-pruning iterator yielded a different receiver");
            require(hintIter == hint, "Non-pruning iterator yielded a different next receiver");
            require(weightIter == weight, "Non-pruning iterator yielded a different weight");
            if (receiver == ReceiverWeightsImpl.ADDR_ROOT) break;
            receiverWeightsIterated.push(ReceiverWeightIterated(receiver, weight));
        }
        if (PRINT_GAS_USAGE) {
            console.log("Iterated over weight list with gas used %d", iterationGasUsed);
            console.log("Total gas used %d", totalGasUsed + iterationGasUsed);
        }
    }

    /// @dev Making `receiverWeightsIterated` public would generate
    /// a getter accepting an index parameter and returning a single item
    function getReceiverWeightsIterated() external view returns (ReceiverWeightIterated[] memory) {
        return receiverWeightsIterated;
    }
}
