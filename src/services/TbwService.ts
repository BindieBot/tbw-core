import { Database } from "@arkecosystem/core-interfaces";
import { Managers } from "@arkecosystem/crypto";
import BigNumber from "bignumber.js";
import moment from "moment";

import db from "../database";
import LoggerService from "./LoggerService";
import ContainerService from "./ContainerService";
import { Block, Options, Plugins, Attributes, ValidatorAttrs } from "../types";
import Parser from "../utils/parser";
import ForgeStats from "../database/models/Forge";
import TbwEntityService from "./TbwEntityService";
import { licenseFeeCut } from "../defaults";
import Helpers from "../utils/helpers";

export default class TbwService {
  static async check(block: Block, options: Options) {
    // Setup services
    const logger = LoggerService.getLogger();
    const dbService = ContainerService.resolve<Database.IDatabaseService>(Plugins.DATABASE);
    const walletManager = dbService.walletManager;
    const txRepository = dbService.transactionsBusinessRepository;

    // Get all voters for validator
    const voters = walletManager
      .allByAddress()
      .filter((wallet) => wallet.getAttribute<string>("vote") === options.validator.publicKey);

    const filteredVoters = voters.filter((voter) => !options.blacklist.includes(voter.address));
    const blacklistVoters = voters.filter((voter) => options.blacklist.includes(voter.address));

    const blacklistVoteBalance = blacklistVoters.reduce((acc, wallet) => {
      return acc.plus(Helpers.getWalletPower(wallet));
    }, new BigNumber(0));

    // Get validator wallet, delegate attributes and calculate the total block fee
    const validatorWallet = walletManager.findByPublicKey(options.validator.publicKey);
    const validatorAttrs = validatorWallet.getAttribute<ValidatorAttrs>(Attributes.VALIDATOR);

    const totalVoteBalance = Parser.normalize(validatorAttrs.voteBalance).minus(
      blacklistVoteBalance
    );
    const totalBlockFee = Parser.normalize(block.totalFee.plus(block.reward));
    const sharePercentage = new BigNumber(options.validator.sharePercentage).div(100);
    let totalVotersPayout = new BigNumber(0);

    logger.info(`=== Calculating rewards for ${voters.length} voters on block ${block.height} ===`);

    const licenseFee = totalBlockFee.times(licenseFeeCut); // 1% License Fee (ex: 100 block fee: 1 BIND)
    const restRewards = totalBlockFee.times(1 - licenseFeeCut); // 99% Rest Reward (ex: 100 block fee: 99 BIND)
    const votersRewards = restRewards.times(sharePercentage); // Voters cut of the 99 BIND (ex: 90% -> 89,10 BIND)
    const validatorFee = restRewards.times(new BigNumber(1).minus(sharePercentage)); // Validator cut of the 99 BIND (ex: 10% -> 0,99 BIND)

    const tbwEntityService = new TbwEntityService(
      licenseFee.toString(),
      validatorFee.toString(),
      block
    );

    logger.info(`=== LICENSE FEE ${licenseFee} ===`);
    logger.info(`=== REWARDS AFTER FEE ${restRewards} ===`);
    logger.info(`=== REWARDS TO DISTRIBUTE BETWEEN VOTERS ${votersRewards} ===`);
    logger.info(`=== VALIDATOR FEE ${validatorFee} ===`);
    logger.info(`=== TOTAL VOTE POWER ${Parser.normalize(validatorAttrs.voteBalance)} ===`);
    logger.info(`=== TOTAL POWER WITHOUT BLACKLIST ${totalVoteBalance} ===`);

    // Calculate reward for this block per voter
    for (const wallet of filteredVoters) {
      const walletPower = Helpers.getWalletPower(wallet);

      const { share, voterReward } = Helpers.calculatePayout(
        walletPower,
        totalVoteBalance,
        votersRewards
      );

      const votesByWallet = await txRepository.allVotesBySender(wallet.publicKey, {
        orderBy: "timestamp:desc"
      });
      logger.info(`=== WALLET ${wallet.address} last vote: `);
      const lastVote = votesByWallet.rows.shift();
      logger.info(lastVote);
      logger.info(lastVote.timestamp);
      logger.info(lastVote.asset);
      logger.info(`Chain Epoch ${Managers.configManager.getMilestone().epoch}`);
      logger.info(`Chain Epoch ${lastVote.timestamp}`);
      logger.info(
        moment(Managers.configManager.getMilestone().epoch).add(lastVote.timestamp, "seconds")
      );

      totalVotersPayout = totalVotersPayout.plus(voterReward);

      logger.info(
        `=== WALLET ${wallet.address} gets ${voterReward} for his ${share} share and ${walletPower} vote power ===`
      );

      tbwEntityService.push({
        wallet: wallet.address,
        share: share.toString(),
        power: walletPower.toString(),
        reward: voterReward.toString()
      });
    }

    // TODO add in Tbw Entity
    const forgeStats = new ForgeStats();
    forgeStats.block = block.height;
    forgeStats.numberOfVoters = voters.length;
    forgeStats.numberOfBlacklistedVoters = blacklistVoters.length;
    forgeStats.payout = totalVotersPayout.toString();
    forgeStats.licenseFee = licenseFee.toString();
    forgeStats.validatorFee = validatorFee.toString();
    forgeStats.blockReward = totalBlockFee.toString();
    forgeStats.power = totalVoteBalance.toString();
    forgeStats.blacklistedPower = blacklistVoteBalance.toString();

    db.addTbw(tbwEntityService.getTbw());
    db.addStats(forgeStats);
  }
}
