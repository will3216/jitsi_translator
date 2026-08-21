{
  description = "Live translated captions — a proof of concept";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [ pkgs.nodejs_22 ];
          shellHook = ''
            echo "node $(node --version)"
            echo "run: npm install && npm run dev"
            echo "needs .env.local with ABLY_API_KEY and ANTHROPIC_API_KEY"
          '';
        };

        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "dev" ''
            export PATH="${pkgs.nodejs_22}/bin:$PATH"
            npm install
            exec npm run dev
          '');
        };
      });
}
