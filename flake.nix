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

        # This flake provides a development shell, not a package. `nix run`
        # is a local convenience that shells out to `npm install` and
        # `npm run dev` — it does live network I/O and writes `node_modules`
        # outside the Nix store, which is deliberately impure. Proper
        # packaging (`pkgs.buildNpmPackage` with a vendored `npmDepsHash`)
        # belongs to the server-side build this proof of concept exists to
        # justify, not to the proof of concept itself. Needs a `.env.local`
        # with ABLY_API_KEY and ANTHROPIC_API_KEY in the working directory.
        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "dev" ''
            if [ ! -f package.json ]; then
              echo "error: run this from a checkout of the repository." >&2
              echo "  git clone <repo> && cd jitsi_translator && nix run" >&2
              exit 1
            fi
            export PATH="${pkgs.nodejs_22}/bin:$PATH"
            npm install
            exec npm run dev
          '');
        };
      });
}
