import BigNumber from "bignumber.js";

import { Voter } from "../types";
import TrueBlockWeight from "./models/TrueBlockWeight";
import VoterModel from "./models/Voters";
import tbwRepository from "./repositories/TBWRepository";
import voterRepository, { voterCountRepository } from "./repositories/VoterRepository";
import LoggerService from "../services/plugin/LoggerService";

export default class DB {
  private constructor() {}

  static async addTbw(tbw: TrueBlockWeight): Promise<void> {
    const foundTbw = await tbwRepository.findById(tbw.id);
    if (foundTbw) {
      LoggerService.getLogger().error(`TBW for blockheight ${tbw.id} already exists`);
    } else {
      await tbwRepository.create(tbw);
    }
  }

  static async updatePending(voters: Voter[]): Promise<void> {
    const allVoters = await voterRepository.find();
    const voterBatch = voterRepository.createBatch();
    let newVoters = 0;

    voters.forEach((voter) => {
      const foundWallet = allVoters.find((v) => v.id === voter.wallet);

      if (foundWallet) {
        foundWallet.pendingBalance = new BigNumber(foundWallet.pendingBalance)
          .plus(voter.reward)
          .toFixed(8);

        voterBatch.update(foundWallet);
      } else {
        const newVoter = new VoterModel();
        newVoter.id = voter.wallet;
        newVoter.wallet = voter.wallet;
        newVoter.paidBalance = "0";
        newVoter.pendingBalance = voter.reward;
        voterBatch.create(newVoter);
        newVoters++;
      }
    });

    await voterBatch.commit();

    // Update new voters count
    const count = await voterCountRepository.findById("count");
    if (count) {
      await voterCountRepository.update({
        id: "count",
        length: count.length + newVoters
      });
    } else {
      await voterCountRepository.create({
        id: "count",
        length: newVoters
      });
    }
  }
}
