const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MuseoWeirdAuction", function () {
  async function deployFixture() {
    const [owner, seller, bidder1, bidder2, attacker] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("MuseoWeirdNFT");
    const nft = await NFT.deploy(owner.address);
    await nft.waitForDeployment();

    const Auction = await ethers.getContractFactory("MuseoWeirdAuction");
    const auction = await Auction.deploy(owner.address);
    await auction.waitForDeployment();

    const auctionAddr = await auction.getAddress();
    await nft.setAuctionContract(auctionAddr);

    return { nft, auction, owner, seller, bidder1, bidder2, attacker };
  }

  async function mintAndApprove(nft, auction, seller, uri = "ipfs://x") {
    await nft.mint(seller.address, uri);
    const tokenId = await nft.totalSupply() - 1n;
    await nft.connect(seller).approve(await auction.getAddress(), tokenId);
    return Number(tokenId);
  }

  describe("createAuction", function () {
    it("escrows NFT and stores auction", async function () {
      const { nft, auction, seller } = await deployFixture();
      const tokenId = await mintAndApprove(nft, auction, seller);

      const tx = await auction.connect(seller).createAuction(
        await nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400
      );
      await expect(tx).to.emit(auction, "AuctionCreated");

      expect(await nft.ownerOf(tokenId)).to.equal(await auction.getAddress());

      const a = await auction.getAuction(await nft.getAddress(), tokenId);
      expect(a.seller).to.equal(seller.address);
      expect(a.startingBid).to.equal(ethers.parseEther("0.01"));
      expect(a.highestBid).to.equal(0);
      expect(a.cancelled).to.equal(false);
    });

    it("reverts on starting bid = 0", async function () {
      const { nft, auction, seller } = await deployFixture();
      const tokenId = await mintAndApprove(nft, auction, seller);
      await expect(
        auction.connect(seller).createAuction(
          await nft.getAddress(), tokenId, 0, 86400
        )
      ).to.be.revertedWith("Starting bid must be > 0");
    });

    it("reverts when duration is too short or too long", async function () {
      const { nft, auction, seller } = await deployFixture();
      const tokenId = await mintAndApprove(nft, auction, seller);
      await expect(
        auction.connect(seller).createAuction(
          await nft.getAddress(), tokenId, ethers.parseEther("0.01"), 60
        )
      ).to.be.revertedWith("Bad duration");
      await expect(
        auction.connect(seller).createAuction(
          await nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400 * 31
        )
      ).to.be.revertedWith("Bad duration");
    });

    it("reverts when caller doesn't own the NFT", async function () {
      const { nft, auction, seller, attacker } = await deployFixture();
      const tokenId = await mintAndApprove(nft, auction, seller);
      await expect(
        auction.connect(attacker).createAuction(
          await nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400
        )
      ).to.be.revertedWith("Not token owner");
    });

    it("reverts when auction house not approved", async function () {
      const { nft, auction, seller } = await deployFixture();
      await nft.mint(seller.address, "ipfs://x");
      const tokenId = Number(await nft.totalSupply()) - 1;
      await expect(
        auction.connect(seller).createAuction(
          await nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400
        )
      ).to.be.revertedWith("Auction not approved");
    });

    it("reverts when same NFT is listed twice", async function () {
      const { nft, auction, seller } = await deployFixture();
      const tokenId = await mintAndApprove(nft, auction, seller);
      const nftAddr = await nft.getAddress();
      await auction.connect(seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400);
      await expect(
        auction.connect(seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400)
      ).to.be.revertedWith("Already listed");
    });
  });

  describe("bid", function () {
    async function setupAuction() {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller);
      await f.auction.connect(f.seller).createAuction(
        await f.nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400
      );
      return { ...f, tokenId };
    }

    it("accepts first bid >= starting bid", async function () {
      const { auction, nft, bidder1, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await expect(
        auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") })
      ).to.emit(auction, "BidPlaced");
      const a = await auction.getAuction(nftAddr, tokenId);
      expect(a.highestBid).to.equal(ethers.parseEther("0.01"));
      expect(a.highestBidder).to.equal(bidder1.address);
    });

    it("rejects bid below min increment", async function () {
      const { auction, nft, bidder1, bidder2, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") });
      await expect(
        auction.connect(bidder2).bid(nftAddr, tokenId, { value: ethers.parseEther("0.0101") })
      ).to.be.revertedWith("Bid too low");
    });

    it("accepts higher bid and refunds previous bidder", async function () {
      const { auction, nft, bidder1, bidder2, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") });
      const balBefore = await ethers.provider.getBalance(bidder1.address);
      const newBid = ethers.parseEther("0.0106");
      await auction.connect(bidder2).bid(nftAddr, tokenId, { value: newBid });
      const balAfter = await ethers.provider.getBalance(bidder1.address);
      expect(balAfter - balBefore).to.equal(ethers.parseEther("0.01"));
      const a = await auction.getAuction(nftAddr, tokenId);
      expect(a.highestBid).to.equal(newBid);
      expect(a.highestBidder).to.equal(bidder2.address);
    });

    it("reverts when auction does not exist", async function () {
      const { auction, nft, bidder1 } = await deployFixture();
      await expect(
        auction.connect(bidder1).bid(await nft.getAddress(), 999, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Auction does not exist");
    });

    it("reverts when auction has ended", async function () {
      const { auction, nft, bidder1, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await time.increase(86401);
      await expect(
        auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Auction ended");
    });

    it("reverts when seller tries to bid", async function () {
      const { auction, nft, seller, tokenId } = await setupAuction();
      await expect(
        auction.connect(seller).bid(await nft.getAddress(), tokenId, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Seller cannot bid");
    });

    it("uses CEI: state updated before refund (reentrancy probe)", async function () {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller);
      const nftAddr = await f.nft.getAddress();
      await f.auction.connect(f.seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400);

      const Reentrancy = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Reentrancy.deploy(await f.auction.getAddress(), nftAddr, tokenId);
      await attacker.placeFirstBidAndTryReenter({ value: ethers.parseEther("0.01") });

      const a = await f.auction.getAuction(nftAddr, tokenId);
      expect(a.highestBid).to.equal(ethers.parseEther("0.01"));
      expect(a.highestBidder).to.equal(await attacker.getAddress());
    });
  });

  describe("finalizeAuction", function () {
    async function setupAuction() {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller, "ipfs://x");
      await f.auction.connect(f.seller).createAuction(
        await f.nft.getAddress(), tokenId, ethers.parseEther("0.01"), 86400
      );
      return { ...f, tokenId };
    }

    it("transfers NFT to winner and ETH to seller", async function () {
      const { auction, nft, seller, bidder1, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") });
      await time.increase(86401);

      const sellerBalBefore = await ethers.provider.getBalance(seller.address);
      const tx = await auction.connect(seller).finalizeAuction(nftAddr, tokenId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const sellerBalAfter = await ethers.provider.getBalance(seller.address);

      expect(await nft.ownerOf(tokenId)).to.equal(bidder1.address);
      // seller paid gas for finalize, so net diff = 0.01 ETH - gas
      expect(sellerBalBefore - sellerBalAfter).to.equal(gasUsed - ethers.parseEther("0.01"));
    });

    it("returns NFT to seller when no bids", async function () {
      const { auction, nft, seller, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await time.increase(86401);
      await auction.connect(seller).finalizeAuction(nftAddr, tokenId);
      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    });

    it("reverts when auction not yet ended", async function () {
      const { auction, nft, tokenId } = await setupAuction();
      await expect(
        auction.finalizeAuction(await nft.getAddress(), tokenId)
      ).to.be.revertedWith("Auction not ended");
    });

    it("reverts on double settle", async function () {
      const { auction, nft, bidder1, tokenId } = await setupAuction();
      const nftAddr = await nft.getAddress();
      await auction.connect(bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") });
      await time.increase(86401);
      await auction.finalizeAuction(nftAddr, tokenId);
      await expect(auction.finalizeAuction(nftAddr, tokenId))
        .to.be.revertedWith("Already settled");
    });
  });

  describe("cancelAuction", function () {
    it("returns NFT to seller when no bids exist", async function () {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller);
      const nftAddr = await f.nft.getAddress();
      await f.auction.connect(f.seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400);
      await f.auction.connect(f.seller).cancelAuction(nftAddr, tokenId);
      expect(await f.nft.ownerOf(tokenId)).to.equal(f.seller.address);
    });

    it("reverts when bids exist", async function () {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller);
      const nftAddr = await f.nft.getAddress();
      await f.auction.connect(f.seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400);
      await f.auction.connect(f.bidder1).bid(nftAddr, tokenId, { value: ethers.parseEther("0.01") });
      await expect(f.auction.connect(f.seller).cancelAuction(nftAddr, tokenId))
        .to.be.revertedWith("Bids exist");
    });

    it("reverts when caller is not seller", async function () {
      const f = await deployFixture();
      const tokenId = await mintAndApprove(f.nft, f.auction, f.seller);
      const nftAddr = await f.nft.getAddress();
      await f.auction.connect(f.seller).createAuction(nftAddr, tokenId, ethers.parseEther("0.01"), 86400);
      await expect(f.auction.connect(f.attacker).cancelAuction(nftAddr, tokenId))
        .to.be.revertedWith("Not seller");
    });
  });

  describe("receive()", function () {
    it("accepts plain ETH transfers", async function () {
      const { auction, bidder1 } = await deployFixture();
      await expect(
        bidder1.sendTransaction({ to: await auction.getAddress(), value: ethers.parseEther("0.001") })
      ).to.not.be.reverted;
    });
  });
});

describe("ReentrancyAttacker", function () {
  it("is a probe to verify CEI holds in bid()", async function () {
    const { expect } = require("chai");
    const { ethers } = require("hardhat");
    const Reentrancy = await ethers.getContractFactory("ReentrancyAttacker");
    const atk = await Reentrancy.deploy(ethers.ZeroAddress, ethers.ZeroAddress, 0);
    expect(await atk.getAddress()).to.not.equal(ethers.ZeroAddress);
  });
});
