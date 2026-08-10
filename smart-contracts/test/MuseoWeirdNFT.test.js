const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MuseoWeirdNFT", function () {
  async function deployNFT() {
    const [owner, alice, bob] = await ethers.getSigners();
    const NFT = await ethers.getContractFactory("MuseoWeirdNFT");
    const nft = await NFT.deploy(owner.address);
    await nft.waitForDeployment();
    return { nft, owner, alice, bob };
  }

  describe("deployment", function () {
    it("sets name, symbol, and owner", async function () {
      const { nft, owner } = await deployNFT();
      expect(await nft.name()).to.equal("Museo Weird");
      expect(await nft.symbol()).to.equal("MWEIRD");
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("sets default royalty to 7.5% for owner", async function () {
      const { nft, owner } = await deployNFT();
      await nft.mint(owner.address, "ipfs://x");
      const [receiver, value] = await nft.royaltyInfo(0, 10000);
      expect(receiver).to.equal(owner.address);
      expect(value).to.equal(750);
    });
  });

  describe("mint", function () {
    it("mints to owner and stores tokenURI", async function () {
      const { nft, owner } = await deployNFT();
      const uri = "ipfs://QmTest123";
      await nft.mint(owner.address, uri);
      expect(await nft.ownerOf(0)).to.equal(owner.address);
      expect(await nft.tokenURI(0)).to.equal(uri);
      expect(await nft.totalSupply()).to.equal(1);
    });

    it("reverts when caller is not owner", async function () {
      const { nft, alice } = await deployNFT();
      await expect(nft.connect(alice).mint(alice.address, "ipfs://x"))
        .to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    it("reverts when tokenURI is empty", async function () {
      const { nft, owner } = await deployNFT();
      await expect(nft.mint(owner.address, ""))
        .to.be.revertedWith("MuseoWeirdNFT: tokenURI required");
    });

    it("increments tokenId sequentially", async function () {
      const { nft, owner } = await deployNFT();
      await nft.mint(owner.address, "ipfs://1");
      await nft.mint(owner.address, "ipfs://2");
      expect(await nft.ownerOf(0)).to.equal(owner.address);
      expect(await nft.ownerOf(1)).to.equal(owner.address);
      expect(await nft.totalSupply()).to.equal(2);
    });

    it("emits NFTMinted", async function () {
      const { nft, owner } = await deployNFT();
      await expect(nft.mint(owner.address, "ipfs://a"))
        .to.emit(nft, "NFTMinted")
        .withArgs(0, owner.address, "ipfs://a");
    });
  });

  describe("updateMetadata", function () {
    it("lets token owner update URI", async function () {
      const { nft, owner } = await deployNFT();
      await nft.mint(owner.address, "ipfs://old");
      await nft.updateMetadata(0, "ipfs://new");
      expect(await nft.tokenURI(0)).to.equal("ipfs://new");
    });

    it("reverts when non-owner tries to update", async function () {
      const { nft, owner, alice } = await deployNFT();
      await nft.mint(owner.address, "ipfs://x");
      await expect(nft.connect(alice).updateMetadata(0, "ipfs://y"))
        .to.be.revertedWith("MuseoWeirdNFT: Not token owner");
    });

    it("reverts on empty URI", async function () {
      const { nft, owner } = await deployNFT();
      await nft.mint(owner.address, "ipfs://x");
      await expect(nft.updateMetadata(0, ""))
        .to.be.revertedWith("MuseoWeirdNFT: tokenURI required");
    });
  });

  describe("setAuctionContract", function () {
    it("sets auction contract (only owner)", async function () {
      const { nft, alice } = await deployNFT();
      const addr = await nft.getAddress();
      await nft.setAuctionContract(addr);
      expect(await nft.auctionContract()).to.equal(addr);
    });

    it("reverts when caller is not owner", async function () {
      const { nft, alice } = await deployNFT();
      await expect(nft.connect(alice).setAuctionContract(alice.address))
        .to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    it("reverts on zero address", async function () {
      const { nft } = await deployNFT();
      await expect(nft.setAuctionContract(ethers.ZeroAddress))
        .to.be.revertedWith("MuseoWeirdNFT: zero address");
    });
  });

  describe("tokenURI on non-existent token", function () {
    it("reverts", async function () {
      const { nft } = await deployNFT();
      await expect(nft.tokenURI(999))
        .to.be.revertedWith("MuseoWeirdNFT: Token does not exist");
    });
  });
});
