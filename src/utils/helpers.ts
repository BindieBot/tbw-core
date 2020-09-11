import { State, Database } from "@arkecosystem/core-interfaces";
import { Utils, Managers } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import moment from "moment";

import { Attributes } from "../types";
import Parser from "./parser";
import OptionsService from "../services/OptionsService";

export default class Helpers {
  public static getWalletPower(wallet: State.IWallet) {
    let walletPower = Parser.normalize(wallet.balance);

    if (wallet.hasAttribute(Attributes.STAKEPOWER)) {
      const stakePower = wallet.getAttribute<Utils.BigNumber>(Attributes.STAKEPOWER);
      walletPower = walletPower.plus(Parser.normalize(stakePower));
    }

    return walletPower;
  }

  // The method to determing the payout of the voter
  // This is seperate logic to allow for easy adjustments to the core payout logic
  public static async calculatePayout(
    wallet: State.IWallet,
    totalVoteBalance: BigNumber,
    votersRewards: BigNumber,
    txRepository: Database.ITransactionsBusinessRepository
  ) {
    // Setup services
    const options = OptionsService.getOptions();

    // Get wallet voting power and all votes of the wallet (last vote first:desc)
    const walletPower = Helpers.getWalletPower(wallet);
    const votesByWallet = await txRepository.allVotesBySender(wallet.publicKey, {
      orderBy: "timestamp:desc"
    });

    // Get last vote from the array and calculate time of voting
    const lastVote = votesByWallet.rows.shift();
    const voteMoment = moment(Managers.configManager.getMilestone().epoch).add(
      lastVote.timestamp,
      "seconds"
    );

    // Determine voting age in days and derive a votinge percentage based on it
    const voteAge = moment.duration(moment().diff(voteMoment)).asDays();
    const voteAgePercentage = new BigNumber(100).div(options.voteStages).div(100);

    // Determine true block weight share of the wallet
    const fullShare = walletPower.div(totalVoteBalance);

    // Cut off true block weight share when vote isn't matured yet
    const share =
      options.voteAge !== 0 && voteAge < options.voteAge
        ? voteAgePercentage.times(voteAge).times(fullShare)
        : fullShare;

    // Calculate reward depending on either the full or cut off share rate
    const voterReward = share.times(votersRewards);

    return {
      share: share.toString(),
      power: walletPower.toString(),
      reward: voterReward.toString()
    };
  }
}