let
  sources = import ./nix/sources.nix;
  pkgs = import sources.dapptools {};
in
  pkgs.mkShell {
    buildInputs = with pkgs; [
      dapp
      seth
      hevm
      niv
      ethsign
      solc-static-versions.solc_0_7_5
    ];
    DAPP_SOLC="solc-0.7.5";
    DAPP_SRC="contracts/tests";
    DAPP_REMAPPINGS=pkgs.lib.strings.fileContents ./remappings.txt;
    DAPP_LINK_TEST_LIBRARIES=0;
  }
