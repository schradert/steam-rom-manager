{
  inputs.nixpkgs.url = github:nixos/nixpkgs/nixos-unstable;
  outputs = inputs: let
    system = "x86_64-linux";
    pkgs = inputs.nixpkgs.legacyPackages.${system};
  in {
    devShells.${system}.default = with pkgs; mkShell {
      packages = [
            nodejs
            yarn
            electron
            (python3.withPackages (ps: [ps.setuptools]))
      ];
    };
  };
}
