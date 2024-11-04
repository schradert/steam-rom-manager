import { VariableParser } from "../../lib";
import { clipboard } from "electron";
import {
  Component,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Renderer2,
  ElementRef,
  RendererStyleFlags2,
} from "@angular/core";
import { FormGroup, AbstractControl } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import {
  ParsersService,
  LoggerService,
  ImageProviderService,
  SettingsService,
  ConfigurationPresetsService,
  ShellScriptsService,
  IpcService,
  UserExceptionsService,
  CustomVariablesService,
} from "../services";
import * as parserInfo from "../../lib/parsers/available-parsers";
import * as steam from "../../lib/helpers/steam";
import { controllerTypes, controllerNames } from "../../lib/controller-manager";
import {
  artworkTypes,
  artworkViewNames,
  artworkSingDict,
} from "../../lib/artwork-types";
import {
  UserConfiguration,
  NestedFormElement,
  AppSettings,
  ConfigPresets,
  ParserType,
  OnlineProviderType,
  StringDict,
  CustomVariables,
} from "../../models";
import { BehaviorSubject, Subscription, of, concat } from "rxjs";
import { map } from "rxjs/operators";
import { APP } from "../../variables";
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as os from "os";
import {
  imageProviderNames,
  onlineProviders,
  providersSelect,
} from "../../lib/image-providers/available-providers";
@Component({
  selector: "parsers",
  templateUrl: "../templates/parsers.component.html",
  styleUrls: ["../styles/parsers.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParsersComponent implements AfterViewInit, OnDestroy {
  currentDoc: { activePath: string; content: string } = {
    activePath: "",
    content: "",
  };
  showMarkdown: boolean = false;
  configurationIndex: number = -1;
  isUnsaved: boolean = false;
  configPresets: ConfigPresets = {};
  customVariables: CustomVariables = {};
  presetsSections: StringDict = {};
  nestedGroup: NestedFormElement.Group;
  userForm: FormGroup;
  chooseUserAccountsVisible: boolean = false;
  steamDirectoryForChooseAccounts: string = "";
  userConfigurations: {
    saved: UserConfiguration;
    current: UserConfiguration;
  }[] = [];
  private subscriptions: Subscription = new Subscription();
  private loadedIndex: number = null;
  private vParser = new VariableParser({ left: "${", right: "}" });
  private appSettings: AppSettings;
  private formChanges: Subscription = new Subscription();
  private chooseAccountsControl: AbstractControl;
  private CLI_MESSAGE: BehaviorSubject<string> = new BehaviorSubject("");

  constructor(
    private parsersService: ParsersService,
    private loggerService: LoggerService,
    private settingsService: SettingsService,
    private imageProviderService: ImageProviderService,
    private userExceptionsService: UserExceptionsService,
    private renderer: Renderer2,
    private elementRef: ElementRef,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private changeRef: ChangeDetectorRef,
    private cpService: ConfigurationPresetsService,
    private cvService: CustomVariablesService,
    private ssService: ShellScriptsService,
    private ipcService: IpcService,
  ) {
    this.appSettings = this.settingsService.getSettings();
    this.currentDoc.content = this.lang.docs__md.intro.join("");
    this.activatedRoute.queryParamMap.subscribe((paramContainer: any) => {
      let params = ({ ...paramContainer } as any).params;
      if (params["cliMessage"]) {
        this.CLI_MESSAGE.next(params["cliMessage"]);
      }
    });
    this.nestedGroup = new NestedFormElement.Group({
      children: {
        basicSection: new NestedFormElement.Section({
          label: "Basic Configuration",
        }),
        parserType: new NestedFormElement.Select({
          label: this.lang.label.parserType,
          placeholder: this.lang.placeholder.parserType,
          sectionsMap: parserInfo.superTypesMap,
          required: true,
          values: parserInfo.availableParsers,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            let parser = this.parsersService.getParserInfo(self.value);
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = parser
              ? parser.info
              : this.lang.docs__md.parserType.join("");
          },
          onChange: (self, path) => {
            let completePath = path.join();
            if (this.currentDoc.activePath === completePath) {
              let parser = this.parsersService.getParserInfo(self.value);
              this.currentDoc.content = parser
                ? parser.info
                : this.lang.docs__md.parserType.join("");
            }
          },
        }),
        configTitle: new NestedFormElement.Input({
          placeholder: this.lang.placeholder.configTitle,
          required: true,
          label: this.lang.label.configTitle,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = this.lang.docs__md.configTitle.join("");
          },
        }),
        steamDirectory: new NestedFormElement.Input({
          path: { directory: true },
          placeholder: this.lang.placeholder.steamDirectory[os.type()],
          required: true,
          label: this.lang.label.steamDirectory,
          highlight: this.highlight.bind(this),
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.steamDirectory.join("");
          },
          buttons: [
            new NestedFormElement.Button({
              buttonLabel: "Global",
              onClickControlMethod: (control: AbstractControl) => {
                control.setValue("${steamdirglobal}");
              },
            }),
          ],
        }),
        userAccounts: new NestedFormElement.Group({
          children: {
            specifiedAccounts: new NestedFormElement.Bubble({
              label: this.lang.label.userAccounts,
              required: true,
              onValidate: (self, path) => {
                let serialized: { [k: string]: any } = {};
                serialized[path[1]] = self.value;
                return this.parsersService.validate(
                  path[0] as keyof UserConfiguration,
                  serialized,
                );
              },
              buttons: [
                new NestedFormElement.Button({
                  buttonLabel: "Choose",
                  onClickControlMethod: (control: AbstractControl) => {
                    this.chooseAccountsControl = control;
                    this.chooseAccounts();
                  },
                }),
                new NestedFormElement.Button({
                  buttonLabel: "Global",
                  onClickControlMethod: (control: AbstractControl) => {
                    control.setValue(["Global"]);
                  },
                }),
              ],
              onInfoClick: (self, path) => {
                this.updateShowMarkdown(true);
                this.currentDoc.activePath = path.join();
                this.currentDoc.content =
                  this.lang.docs__md.userAccounts.join("");
              },
            }),
          },
        }),
        romDirectory: new NestedFormElement.Input({
          path: { directory: true },
          placeholder: this.lang.placeholder.romDirectory[os.type()],
          required: true,
          isHidden: () => this.isHiddenIfNotRomsParser(),
          label: this.lang.label.romDirectory,
          highlight: this.highlight.bind(this),
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = this.lang.docs__md.romDirectory.join("");
          },
        }),
        steamCategories: new NestedFormElement.Bubble({
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          addable: true,
          label: this.lang.label.steamCategories,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.steamCategories.join("");
          },
        }),
        parserInputsSection: new NestedFormElement.Section({
          label: "Parser Specific Configuration",
          isHidden: () => this.isHiddenIfNoParserInputs(),
        }),
        parserInputs: (() => {
          let parsers = parserInfo.availableParsers;
          let parserInputs: { [k: string]: any } = {};
          for (let i = 0; i < parsers.length; i++) {
            let parser = this.parsersService.getParserInfo(parsers[i]);
            if (parser && parser.inputs !== undefined) {
              for (let inputFieldName in parser.inputs) {
                let input = parser.inputs[inputFieldName];
                const isHidden = () => {
                  return concat(
                    of(this.userForm.get("parserType").value),
                    this.userForm.get("parserType").valueChanges,
                  ).pipe(
                    map((pType: string) => {
                      return input.hidden || pType !== parsers[i];
                    }),
                  );
                };
                const onInfoClick = (self: any, path: string[]) => {
                  this.currentDoc.activePath = path.join();
                  this.currentDoc.content = input.info;
                  this.updateShowMarkdown(true);
                };
                if (["path", "dir", "text"].includes(input.inputType)) {
                  parserInputs[inputFieldName] = new NestedFormElement.Input({
                    path: ["path", "dir"].includes(input.inputType)
                      ? {
                          directory: input.inputType === "dir",
                        }
                      : undefined,
                    placeholder: input.placeholder,
                    required: !!input.required,
                    highlight: this.highlight.bind(this),
                    initialValue: input.initialValue as string,
                    label: input.label,
                    isHidden: isHidden,
                    onValidate: (self, path) => {
                      if (
                        parserInfo.superTypesMap[parsers[i]] !==
                          parserInfo.ArtworkOnlyType &&
                        this.userForm.get("parserType").value === parsers[i]
                      )
                        return this.parsersService.validate(
                          path[0] as keyof UserConfiguration,
                          {
                            parser: parsers[i],
                            input: inputFieldName,
                            inputData: self.value as string,
                          },
                        );
                      else return null;
                    },
                    onInfoClick: onInfoClick,
                  });
                } else if (input.inputType == "toggle") {
                  parserInputs[inputFieldName] = new NestedFormElement.Toggle({
                    text: input.label,
                    isHidden: isHidden,
                  });
                } else if (input.inputType == "multiselect") {
                  parserInputs[inputFieldName] = new NestedFormElement.Select({
                    label: input.label,
                    multiple: true,
                    allowEmpty: false,
                    values: input.allowedValues,
                    initialValue: input.initialValue as string[],
                    onInfoClick: onInfoClick,
                    isHidden: isHidden,
                  });
                }
              }
            }
          }

          return new NestedFormElement.Group({
            children: parserInputs,
          });
        })(),
        executableSection: new NestedFormElement.Section({
          label: "Executable Configuration",
          isHidden: () => this.isHiddenIfNotRomsParser(),
        }),
        executable: new NestedFormElement.Group({
          isHidden: () => this.isHiddenIfNotRomsParser(),
          children: {
            path: new NestedFormElement.Input({
              path: { directory: false },
              label: this.lang.label.executableLocation,
              placeholder: this.lang.placeholder.executableLocation[os.type()],
              highlight: this.highlight.bind(this),
              important: true,
              onValidate: (self, path) => {
                let serialized: { [k: string]: any } = {};
                serialized[path[1]] = self.value;
                return this.parsersService.validate(
                  path[0] as keyof UserConfiguration,
                  serialized,
                );
              },
              onInfoClick: (self, path) => {
                this.currentDoc.activePath = path.join();
                this.currentDoc.content =
                  this.lang.docs__md.executableLocation.join("");
              },
            }),

            //TODO Move shortcutPassthrough to glob and glob regex parser inputs
            //TODO Move appendArgsToExecutable to child of executableArgs group
            //TODO Make Executable required but have the option to set it to None
            shortcutPassthrough: new NestedFormElement.Toggle({
              text: this.lang.text.shortcut_passthrough,
            }),
            appendArgsToExecutable: new NestedFormElement.Toggle({
              isHidden: () => this.isHiddenIfNotRomsParser(),
              text: this.lang.text.appendArgsToExecutable,
            }),
          },
        }),
        executableArgs: new NestedFormElement.Input({
          placeholder: this.lang.placeholder.executableArgs,
          isHidden: () => this.isHiddenIfNotRomsParser(),
          label: this.lang.label.executableArgs,
          highlight: this.highlight.bind(this),
          important: true,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.executableArgs.join("");
          },
        }),
        executableModifier: new NestedFormElement.Input({
          isHidden: () => this.isHiddenIfNotRomsParser(),
          highlight: this.highlight.bind(this),
          label: this.lang.label.executableModifier,
          placeholder: this.lang.placeholder.executableModifier,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.executableModifier.join("");
          },
        }),
        startInDirectory: new NestedFormElement.Input({
          path: { directory: true },
          placeholder: this.lang.placeholder.startInDirectory[os.type()],
          label: this.lang.label.startInDirectory,
          highlight: this.highlight.bind(this),
          isHidden: () => this.isHiddenIfNotRomsParser(),
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.startInDirectory.join("");
          },
        }),
        titleSection: new NestedFormElement.Section({
          label: "Title Modification Configuration",
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          startMinimized: true,
        }),
        titleModifier: new NestedFormElement.Input({
          highlight: this.highlight.bind(this),
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          placeholder: this.lang.placeholder.titleModifier,
          label: this.lang.label.titleModifier,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = this.lang.docs__md.titleModifier.join("");
          },
        }),
        titleFromVariable: new NestedFormElement.Group({
          isHidden: () => this.isHiddenIfNotRomsParser(),
          label: this.lang.label.titleFromVariable,
          children: {
            limitToGroups: new NestedFormElement.Select({
              multiple: true,
              allowEmpty: true,
              values: Object.keys(this.customVariables),
              placeholder: "Select title variables",
            }),
            /*limitToGroups: new NestedFormElement.Input({
              placeholder: this.lang.placeholder.titleFromVariable,
              highlight: this.highlight.bind(this),
              onValidate: (self, path) => {
                let serialized: { [k: string]: any } = {};
                serialized[path[1]] = self.value;
                return this.parsersService.validate(
                  path[0] as keyof UserConfiguration,
                  serialized,
                );
              },
            }),*/
            caseInsensitiveVariables: new NestedFormElement.Toggle({
              text: this.lang.text.caseInsensitiveVariables,
            }),
            skipFileIfVariableWasNotFound: new NestedFormElement.Toggle({
              text: this.lang.text.skipFileIfVariableWasNotFound,
            }),
          },
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.titleFromVariable.join("");
          },
        }),
        fuzzyMatch: new NestedFormElement.Group({
          label: this.lang.label.fuzzyMatch,
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          children: {
            replaceDiacritics: new NestedFormElement.Toggle({
              text: this.lang.text.fuzzy_replaceDiacritic,
            }),
            removeCharacters: new NestedFormElement.Toggle({
              text: this.lang.text.fuzzy_removeCharacters,
            }),
            removeBrackets: new NestedFormElement.Toggle({
              text: this.lang.text.fuzzy_removeBrackets,
            }),
          },
          onInfoClick: (control, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = this.lang.docs__md.fuzzyMatch.join("");
          },
        }),
        controllerSection: new NestedFormElement.Section({
          label: "Controller Templates Configuration",
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          startMinimized: true,
        }),
        fetchControllerTemplatesButton: new NestedFormElement.Button({
          buttonLabel: "Re-fetch Controller Templates",
          onClickMethod: this.fetchControllerTemplates.bind(this),
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
        }),
        removeControllersButton: new NestedFormElement.Button({
          buttonLabel: "Unset Controllers for Parser",
          onClickMethod: this.removeControllers.bind(this),
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
        }),
        steamInputEnabled: new NestedFormElement.Select({
          isHidden: () => this.isHiddenIfArtworkOnlyParser(),
          label: "Enable Steam Input",
          placeholder: "Use default settings",
          values: [
            { value: "0", displayValue: "Disabled" },
            { value: "1", displayValue: "Use default settings" },
            { value: "2", displayValue: "Enabled" },
          ],
        }),
        controllers: new NestedFormElement.Group({
          children: (() => {
            let children: { [k: string]: any } = {};
            for (let controllerType of controllerTypes) {
              children[controllerType] = new NestedFormElement.Select({
                isHidden: () => this.isHiddenIfArtworkOnlyParser(),
                label:
                  controllerNames[
                    controllerType as keyof typeof controllerNames
                  ] +
                  " " +
                  "Template",
                placeholder: "Select a Template",
                multiple: false,
                allowEmpty: true,
                values: [],
                onInfoClick: (self, path) => {
                  this.currentDoc.activePath = path.join();
                  this.currentDoc.content =
                    this.lang.docs__md.controllerTemplates.join("");
                },
              });
            }
            return children;
          })(),
        }),
        onlineImageSection: new NestedFormElement.Section({
          label: "Artwork Provider Configuration",
          startMinimized: true,
        }),
        imageProviders: new NestedFormElement.Select({
          label: this.lang.label.imageProviders,
          placeholder: this.lang.placeholder.imageProviders,
          multiple: true,
          allowEmpty: true,
          values: providersSelect,
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.imageProviders.join("");
          },
        }),
        onlineImageQueries: new NestedFormElement.Bubble({
          label: this.lang.label.onlineImageQueries,
          highlight: this.highlight.bind(this),
          addable: true,
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content =
              this.lang.docs__md.onlineImageQueries.join("");
          },
        }),
        imagePool: new NestedFormElement.Input({
          label: this.lang.label.imagePool,
          placeholder: this.lang.placeholder.imagePool,
          highlight: this.highlight.bind(this),
          onValidate: (self, path) =>
            this.parsersService.validate(
              path[0] as keyof UserConfiguration,
              self.value,
            ),
          onInfoClick: (self, path) => {
            this.currentDoc.activePath = path.join();
            this.currentDoc.content = this.lang.docs__md.imagePool.join("");
          },
        }),
        drmProtect: new NestedFormElement.Toggle({
          text: "Local backups (DRM takedown protection)",
        }),
        imageProviderAPIs: (() => {
          let imageProviderAPIInputs: { [k: string]: NestedFormElement.Group } =
            {};
          let providerKeys = onlineProviders;
          for (let i = 0; i < providerKeys.length; i++) {
            let provider = this.imageProviderService.instance.getProviderInfo(
              providerKeys[i],
            );
            let providerL =
              this.imageProviderService.instance.getProviderInfoLang(
                providerKeys[i],
              );
            if (
              provider &&
              provider.inputs &&
              Object.keys(provider.inputs).length
            ) {
              imageProviderAPIInputs[providerKeys[i]] = (() => {
                let apiInputs: { [k: string]: any } = {};
                for (let inputFieldName in provider.inputs) {
                  let input = provider.inputs[inputFieldName];
                  if (input.inputType == "toggle") {
                    apiInputs[inputFieldName] = new NestedFormElement.Toggle({
                      text: providerL.inputs[inputFieldName].label,
                      isHidden: () =>
                        this.isHiddenIfNoProvider(providerKeys[i]),
                    });
                  } else if (input.inputType == "multiselect") {
                    apiInputs[inputFieldName] = new NestedFormElement.Select({
                      label: providerL.inputs[inputFieldName].label,
                      multiple: input.multiple,
                      allowEmpty: input.allowEmpty,
                      placeholder: this.lang.placeholder.multiAPIPlaceholder,
                      isHidden: () =>
                        this.isHiddenIfNoProvider(providerKeys[i]),
                      values: input.allowedValues.map((option: string) => {
                        return {
                          value: option,
                          displayValue: option.replace(/_/g, " ").startCase(),
                        };
                      }),
                      onValidate: (self, path) => {
                        return null;
                      },
                      onInfoClick: (self, path) => {
                        this.currentDoc.activePath = path.join();
                        this.currentDoc.content =
                          providerL.inputs[inputFieldName].info;
                      },
                    });
                  }
                }
                return new NestedFormElement.Group({
                  children: {
                    section: new NestedFormElement.Section({
                      label: `Filters for ${imageProviderNames[providerKeys[i]]}`,
                      isHidden: () =>
                        this.isHiddenIfNoProvider(providerKeys[i]),
                    }),
                    ...apiInputs,
                  },
                });
              })();
            }
          }
          return new NestedFormElement.Group({
            children: imageProviderAPIInputs,
          });
        })(),
        localImageSection: new NestedFormElement.Section({
          label: "Local Artwork Configuration",
          startMinimized: true,
        }),
        defaultImage: (() => {
          let defaultImageInputs: { [k: string]: NestedFormElement.Input } = {};
          for (const artworkType of artworkTypes) {
            defaultImageInputs[artworkType] = new NestedFormElement.Input({
              path: { directory: false, useForwardSlash: true },
              placeholder: this.lang.placeholder.defaultImage__i[
                os.type()
              ].interpolate({
                artworkType: artworkSingDict[artworkType],
              }),
              highlight: this.highlight.bind(this),
              label: this.lang.label.defaultImage__i.interpolate({
                artworkType: artworkSingDict[artworkType],
              }),
              onValidate: (self, path) =>
                this.parsersService.validate(path[0], self.value),
              onInfoClick: (self, path) => {
                this.currentDoc.activePath = path.join();
                this.currentDoc.content =
                  this.lang.docs__md.defaultImage.join("");
              },
            });
          }
          return new NestedFormElement.Group({
            children: defaultImageInputs,
          });
        })(),
        localImages: (() => {
          let localImagesInputs: { [k: string]: NestedFormElement.Input } = {};
          for (const artworkType of artworkTypes) {
            localImagesInputs[artworkType] = new NestedFormElement.Input({
              path: {
                directory: true,
                appendGlob: "${title}.@(png|PNG|jpg|JPG|webp|WEBP)",
              },
              placeholder: this.lang.placeholder.localImages__i[
                os.type()
              ].interpolate({
                artworkType: artworkViewNames[artworkType].toLowerCase(),
              }),
              highlight: this.highlight.bind(this),
              label: this.lang.label.localImages__i.interpolate({
                artworkType: artworkViewNames[artworkType].toLowerCase(),
              }),
              onValidate: (self, path) => {
                return this.parsersService.validate(path[0], self.value);
              },
              onInfoClick: (self, path) => {
                this.currentDoc.activePath = path.join();
                this.currentDoc.content =
                  this.lang.docs__md.localImages.join("");
              },
            });
          }
          return new NestedFormElement.Group({
            children: localImagesInputs,
          });
        })(),
      },
    });
  }

  get lang() {
    return APP.lang.parsers.component;
  }

  get parserInfo() {
    return parserInfo;
  }

  updateShowMarkdown(showMarkdown: boolean) {
    this.showMarkdown = showMarkdown;
    if (this.showMarkdown) {
      this.renderer.setStyle(
        this.elementRef.nativeElement,
        "--markdown-width",
        "1fr",
        RendererStyleFlags2.DashCase,
      );
    } else {
      this.renderer.setStyle(
        this.elementRef.nativeElement,
        "--markdown-width",
        "0fr",
        RendererStyleFlags2.DashCase,
      );
    }
  }

  ngAfterViewInit() {
    this.subscriptions.add(
      this.parsersService.getUserConfigurations().subscribe((data) => {
        this.userConfigurations = data;
        this.loadConfiguration();
      }),
    );
    this.subscriptions.add(
      this.activatedRoute.params.subscribe((params: any) => {
        this.configurationIndex = parseInt(params["index"]);
        if (this.configurationIndex !== -1) {
          this.currentDoc.activePath = "parserType";
        } else {
          this.currentDoc.activePath = "";
          this.currentDoc.content = this.lang.docs__md.intro.join("");
        }
        this.loadConfiguration();
      }),
    );
    this.subscriptions.add(
      this.cpService.dataObservable.subscribe((data) => {
        this.configPresets = data;
        this.presetsSections = Object.fromEntries(
          Object.keys(this.configPresets)
            .map((presetName) => [
              presetName,
              parserInfo.superTypesMap[
                this.configPresets[presetName].parserType
              ],
            ])
            .sort((a, b) => a[1].localeCompare(b[1])),
        );
      }),
    );
    this.subscriptions.add(
      this.cvService.dataObservable.subscribe((data) => {
        this.customVariables = data;
        if (this.nestedGroup) {
          (
            (
              this.nestedGroup.children
                .titleFromVariable as NestedFormElement.Group
            ).children.limitToGroups as NestedFormElement.Select
          ).values = Object.keys(this.customVariables);
        }
        this.changeRef.detectChanges();
      }),
    );
    this.subscriptions.add(
      this.parsersService.getSavedControllerTemplates().subscribe((data) => {
        this.parsersService.controllerTemplates = data;
        this.fetchControllerTemplates(false);
      }),
    );
    this.subscriptions.add(
      this.CLI_MESSAGE.asObservable().subscribe((cliMessage: string) => {
        const parsedCLI = cliMessage ? JSON.parse(cliMessage) || {} : {};
        this.parsersService.onLoad(
          (userConfigurations: UserConfiguration[]) => {
            if (parsedCLI.command == "list") {
              this.ipcService.send("parsers_list", userConfigurations);
            } else if (["enable", "disable"].includes(parsedCLI.command)) {
              let newStatus: boolean = parsedCLI.command == "enable";
              if (parsedCLI.flags["all"]) {
                this.parsersService
                  .changeEnabledStatusAll(newStatus)
                  .then(() => {
                    this.ipcService.send("all_done");
                  });
              } else {
                let promises: Promise<void>[] = [];
                let parserIds: string[];
                if (parsedCLI.flags["names"]) {
                  parserIds = userConfigurations
                    .filter(
                      (config) =>
                        parsedCLI.args.indexOf(
                          config.configTitle.replace(/[^\x20-\x7E]+/g, ""),
                        ) != -1,
                    )
                    .map((config) => config.parserId);
                  for (let configTitle of parsedCLI.args) {
                    if (
                      userConfigurations
                        .map((config) =>
                          config.configTitle.replace(/[^\x20-\x7E]+/g, ""),
                        )
                        .indexOf(configTitle) == -1
                    ) {
                      this.ipcService.send(
                        "log",
                        `Could not find parser ${configTitle}`,
                      );
                    }
                  }
                } else {
                  parserIds = parsedCLI.args;
                }
                for (let parserId of parserIds) {
                  try {
                    promises.push(
                      this.parsersService
                        .changeEnabledStatus(parserId, newStatus)
                        .then(() => {
                          this.ipcService.send(
                            "log",
                            newStatus
                              ? `Enabled parser ${parserId}`
                              : `Disabled parser ${parserId}`,
                          );
                        }),
                    );
                  } catch (e) {
                    this.ipcService.send("log", e);
                  }
                }
                Promise.all(promises).then(() => {
                  this.ipcService.send("all_done");
                });
              }
            } else if (["import"].includes(parsedCLI.command)) {
              for (let jsonFile of parsedCLI.args) {
                fs.readFile(jsonFile, "utf8", (error: any, data: any) => {
                  if (error) {
                    this.ipcService.send("log", error);
                  } else {
                    try {
                      const parsed = JSON.parse(data) || [];
                      const configurations: UserConfiguration[] = Array.isArray(parsed) ? parsed : [parsed];
                      for (let saved of configurations) {
                        if (!this.parsersService.isConfigurationValid(saved)) {
                          this.ipcService.send("log", `User configuration is not valid: ${JSON.stringify(saved)}`);
                        } else {
                          const current = userConfigurations.filter(cfg => saved.configTitle == cfg.configTitle).at(0) || null;
                          this.parsersService.saveConfiguration({ saved, current });
                        }
                      }
                    } catch (e) {
                      this.ipcService.send("log", e);
                    }
                  }
                });
              }
              this.ipcService.send("all_done");
            }
          },
        );
      }),
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.formChanges.unsubscribe();
  }

  getDeletedConfigurations() {
    return this.parsersService.getDeletedConfigurations();
  }

  setPreset(key: string) {
    if (key != null) {
      const config = this.configPresets[key];
      if (this.loadedIndex === -1) {
        this.userForm.patchValue(config);
        this.changeRef.detectChanges();
      } else
        this.parsersService.setCurrentConfiguration(
          this.configurationIndex,
          config,
        );
    }
  }

  presetsInfoClick() {
    this.updateShowMarkdown(true);
    this.currentDoc.activePath = "";
    this.currentDoc.content = this.lang.docs__md.communityPresets.join("");
  }

  openFAQ() {
    this.currentDoc.activePath = "";
    this.currentDoc.content = this.lang.docs__md.faq.join("");
  }

  saveForm() {
    if (this.userConfigurations.length === 0 || this.configurationIndex === -1)
      this.parsersService.saveConfiguration({
        saved: this.userForm.value as UserConfiguration,
        current: null,
      });
    else
      this.parsersService.saveConfiguration(
        this.userConfigurations[this.configurationIndex],
      );

    this.router.navigate(["/parsers", this.userConfigurations.length - 1]);
  }

  updateForm() {
    this.parsersService.updateConfiguration(this.configurationIndex);
  }

  deleteForm() {
    this.parsersService.deleteConfiguration(this.configurationIndex);
    if (this.configurationIndex >= this.userConfigurations.length)
      this.router.navigate(["/parsers", this.userConfigurations.length - 1]);
  }

  restoreForm() {
    this.parsersService.restoreConfiguration();
  }

  toClipboard() {
    let config = this.userForm.value as UserConfiguration;
    config.parserId =
      this.configurationIndex === -1
        ? "UNSAVED SO NO ID"
        : this.parsersService.getParserId(this.configurationIndex);
    if (this.parsersService.isConfigurationValid(config)) {
      try {
        let text = "";

        let iterateGroup = (group: NestedFormElement.Group, path: string) => {
          let keys = Object.keys(group.children);

          if (group.label) text += `# ${group.label}\r\n`;

          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const item = group.children[key];
            const itemPath = path.length > 0 ? `${path}.${key}` : key;

            if (item instanceof NestedFormElement.Group) {
              iterateGroup(item, itemPath);
            } else if (
              item instanceof NestedFormElement.Input ||
              item instanceof NestedFormElement.Bubble
            ) {
              let title = item.label;
              if (title) text += `# ${title}\r\n`;

              text += `····${this.userForm.get(itemPath).value}\r\n`;
            } else if (item instanceof NestedFormElement.Toggle) {
              let title = item.label || item.text;

              text += `····${this.userForm.get(itemPath).value ? "[x]" : "[ ]"}: ${title}\r\n`;
            } else if (item instanceof NestedFormElement.Select) {
              let title = item.label;
              if (title) text += `# ${title}\r\n`;

              text += `····Selected: ${this.userForm.get(itemPath).value}\r\n`;
            }
          }
        };

        iterateGroup(this.nestedGroup, "");

        clipboard.writeText(`\`\`\`\r\n${text}\`\`\``);
        this.loggerService.info(this.lang.info.copiedToClipboard, {
          invokeAlert: true,
          alertTimeout: 3000,
        });
      } catch (error) {
        this.loggerService.error(this.lang.error.failedToCopy, {
          invokeAlert: true,
          alertTimeout: 3000,
        });
        if (error)
          this.loggerService.error(error, {
            invokeAlert: true,
            alertTimeout: 3000,
          });
      }
    } else
      this.loggerService.error(this.lang.error.cannotCopyInvalid, {
        invokeAlert: true,
        alertTimeout: 3000,
      });
  }

  testForm() {
    let config = this.userForm.value as UserConfiguration;
    config.parserId =
      this.configurationIndex === -1
        ? "UNSAVED SO NO ID"
        : this.parsersService.getParserId(this.configurationIndex);
    let successData: string = "";
    let errorData: string = "";

    let logError = () => {
      if (errorData) this.loggerService.error(errorData);
      errorData = "";
    };
    let logSuccess = () => {
      if (successData) this.loggerService.success(successData);
      successData = "";
    };

    let success = (data: string) => {
      logError();
      if (successData) successData += "\r\n";
      successData += data;
    };
    let error = (data: string) => {
      logSuccess();
      if (errorData) errorData += "\r\n";
      errorData += data;
    };

    if (this.parsersService.isConfigurationValid(config)) {
      if (this.appSettings.clearLogOnTest) {
        this.loggerService.clearLog();
      }
      success("Parser ID: ".concat(config.parserId));
      success("");
      this.parsersService
        .executeFileParser(config)
        .then((dataArray) => {
          if (dataArray.parsedData.parsedConfigs.length > 0) {
            let data = dataArray.parsedData.parsedConfigs[0];
            let totalLength =
              data.files.length + data.failed.length + data.excluded.length;

            if (data.foundUserAccounts.length > 0) {
              this.loggerService.info("");
              success(
                this.lang.success.foundAccounts__i.interpolate({
                  count: data.foundUserAccounts.length,
                }),
              );
              for (let i = 0; i < data.foundUserAccounts.length; i++) {
                success(
                  this.lang.success.foundAccountInfo__i.interpolate({
                    name: data.foundUserAccounts[i].name,
                    steamID64: data.foundUserAccounts[i].steamID64,
                    accountID: data.foundUserAccounts[i].accountID,
                  }),
                );
              }
            }
            if (data.missingUserAccounts.length > 0) {
              logSuccess();
              this.loggerService.info("");
              error(
                this.lang.error.missingAccounts__i.interpolate({
                  count: data.missingUserAccounts.length,
                }),
              );
              for (let i = 0; i < data.missingUserAccounts.length; i++) {
                error(
                  this.lang.error.missingAccountInfo__i.interpolate({
                    name: data.missingUserAccounts[i],
                  }),
                );
              }
            }

            if (dataArray.parsedData.noUserAccounts) {
              logError();
              this.loggerService.info("");
              error(this.lang.error.noAccountsWarning);
            }

            logSuccess();
            logError();
            this.loggerService.info("");
            success("");
            success("Number of Titles: ".concat(data.files.length.toString()));
            data.files = data.files.sort((a, b) =>
              a.extractedTitle.localeCompare(b.extractedTitle),
            );
            for (let i = 0; i < data.files.length; i++) {
              success("");
              const executableLocation =
                data.files[i].modifiedExecutableLocation;
              const title = data.files[i].finalTitle;
              let shortAppId;
              if (
                parserInfo.superTypesMap[config.parserType] !==
                parserInfo.ArtworkOnlyType
              ) {
                shortAppId = steam.generateShortAppId(
                  executableLocation,
                  title,
                );
              } else {
                shortAppId = executableLocation.replace(/\"/g, "");
              }
              const appId = steam.lengthenAppId(shortAppId);
              const exceptionKey = this.userExceptionsService.makeExceptionId(
                executableLocation,
                data.files[i].extractedTitle,
                config.parserType,
              );

              success(
                this.lang.success.exceptionKey__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  appid: exceptionKey,
                }),
              );
              success(
                this.lang.success.shortAppId__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  appid: shortAppId,
                }),
              );
              success(
                this.lang.success.appId__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  appid: appId,
                }),
              );
              success(
                this.lang.success.extractedTitle__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  title: data.files[i].extractedTitle,
                }),
              );
              success(
                this.lang.success.fuzzyTitle__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  title: data.files[i].fuzzyTitle,
                }),
              );
              success(
                this.lang.success.finalTitle__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  title: data.files[i].finalTitle,
                }),
              );
              success(
                this.lang.success.filePath__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  filePath: data.files[i].filePath,
                }),
              );
              success(
                this.lang.success.startDir__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  startDir: data.files[i].startInDirectory,
                }),
              );
              success(
                this.lang.success.completeShortcut__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  shortcut:
                    `${data.files[i].modifiedExecutableLocation} ${data.files[i].argumentString}`.trim(),
                }),
              );
              if (data.files[i].steamCategories.length > 0) {
                success(
                  this.lang.success.steamCategories__i.interpolate({
                    index: i + 1,
                    total: totalLength,
                    steamCategories: data.files[i].steamCategories,
                  }),
                );
                for (let j = 1; j < data.files[i].steamCategories.length; j++) {
                  success(
                    this.lang.success.steamCategoriesInfo__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      steamCategories: data.files[i].steamCategories,
                    }),
                  );
                }
              }
              success(
                this.lang.success.imagePool__i.interpolate({
                  index: i + 1,
                  total: totalLength,
                  imagePool: data.files[i].imagePool,
                }),
              );
              if (data.files[i].onlineImageQueries.length) {
                success(
                  this.lang.success.firstImageQuery__i.interpolate({
                    index: i + 1,
                    total: totalLength,
                    query: data.files[i].onlineImageQueries[0],
                  }),
                );
                for (
                  let j = 1;
                  j < data.files[i].onlineImageQueries.length;
                  j++
                ) {
                  success(
                    this.lang.success.imageQueries__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      query: data.files[i].onlineImageQueries[j],
                    }),
                  );
                }
              }
              for (const artworkType of artworkTypes) {
                if (data.files[i].resolvedDefaultImages[artworkType].length) {
                  success(
                    this.lang.success.resolvedDefaultImage__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      artworkType: artworkSingDict[artworkType],
                    }),
                  );
                  for (
                    let j = 0;
                    j < data.files[i].resolvedDefaultImages[artworkType].length;
                    j++
                  ) {
                    success(
                      this.lang.success.indexInfo__i.interpolate({
                        index: i + 1,
                        total: totalLength,
                        indexed:
                          data.files[i].resolvedDefaultImages[artworkType][j],
                      }),
                    );
                  }
                }
                if (data.files[i].defaultImage[artworkType]) {
                  success(
                    this.lang.success.defaultImage__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      artworkType: artworkSingDict[artworkType],
                      image: data.files[i].defaultImage[artworkType],
                    }),
                  );
                }
                if (data.files[i].resolvedLocalImages[artworkType].length) {
                  success(
                    this.lang.success.resolvedLocalImages__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      artworkType: artworkViewNames[artworkType],
                    }),
                  );
                  for (
                    let j = 0;
                    j < data.files[i].resolvedLocalImages[artworkType].length;
                    j++
                  ) {
                    success(
                      this.lang.success.indexInfo__i.interpolate({
                        index: i + 1,
                        total: totalLength,
                        indexed:
                          data.files[i].resolvedLocalImages[artworkType][j],
                      }),
                    );
                  }
                }
                if (data.files[i].localImages[artworkType].length) {
                  success(
                    this.lang.success.localImages__i.interpolate({
                      index: i + 1,
                      total: totalLength,
                      artworkType: artworkViewNames[artworkType].toLowerCase(),
                    }),
                  );
                  for (
                    let j = 0;
                    j < data.files[i].localImages[artworkType].length;
                    j++
                  ) {
                    success(
                      this.lang.success.indexInfo__i.interpolate({
                        index: i + 1,
                        total: totalLength,
                        indexed: data.files[i].localImages[artworkType][j],
                      }),
                    );
                  }
                }
              }
            }
            logSuccess();
            if (data.failed.length > 0) {
              this.loggerService.info("");
              error(this.lang.error.failedToMatch);
              for (let i = 0; i < data.failed.length; i++) {
                error(
                  this.lang.error.failedFileInfo__i.interpolate({
                    index: data.files.length + i + 1,
                    total: totalLength,
                    filename: data.failed[i],
                  }),
                );
              }
            }
            if (data.excluded.length > 0) {
              this.loggerService.info("");
              this.loggerService.info(this.lang.info.userExclusions);
              for (let i = 0; i < data.excluded.length; i++) {
                this.loggerService.info(
                  this.lang.info.excludedFileInfo__i.interpolate({
                    index: data.files.length + data.failed.length + i + 1,
                    total: totalLength,
                    filename: data.excluded[i].filePath,
                    exceptionKey: data.excluded[i].exceptionKey,
                  }),
                );
              }
            }
            logError();
          } else {
            this.loggerService.info("");
            this.loggerService.info(this.lang.info.nothingWasFound);
          }
          this.loggerService.info("");
          this.loggerService.info(this.lang.info.testCompleted);
        })
        .catch((error) => {
          this.loggerService.error(this.lang.error.testFailed);
          this.loggerService.error(error);
        });
      this.loggerService.info(
        this.lang.info.testStarting__i.interpolate({
          title: config.configTitle || this.lang.text.noTitle,
          version: APP.version,
          portable: APP.srmdir ? "Portable" : "Non-Portable",
        }),
      );
      this.loggerService.info(
        this.lang.info.opSys__i.interpolate({
          os: APP.os,
        }),
      );
      this.router.navigateByUrl("/logger");
    } else {
      this.loggerService.error(this.lang.error.cannotTestInvalid, {
        invokeAlert: true,
        alertTimeout: 3000,
      });
    }
  }

  moveUp() {
    if (this.configurationIndex > 0) {
      this.parsersService.swapIndex(
        this.configurationIndex,
        this.configurationIndex - 1,
      );
      this.router.navigate(["/parsers", this.configurationIndex - 1]);
    }
  }

  moveDown() {
    if (this.configurationIndex + 1 < this.userConfigurations.length) {
      this.parsersService.swapIndex(
        this.configurationIndex,
        this.configurationIndex + 1,
      );
      this.router.navigate(["/parsers", this.configurationIndex + 1]);
    }
  }

  undoChanges() {
    this.parsersService.setCurrentConfiguration(this.configurationIndex, null);
  }

  chooseAccounts() {
    let steamDirInput = this.userForm.get("steamDirectory").value || "";
    let steamDir = this.parsersService.parseSteamDir(steamDirInput);
    if (this.parsersService.validate("steamDirectory", steamDir) == null) {
      this.chooseUserAccountsVisible = true;
      this.steamDirectoryForChooseAccounts = steamDir;
    }
  }

  setUserAccounts(accounts: string[]) {
    if (accounts && this.chooseAccountsControl) {
      this.chooseAccountsControl.setValue(accounts);
    }
  }

  exitChooseAccounts() {
    this.chooseUserAccountsVisible = false;
  }

  private observeField(path: string | string[], decider: (x: any) => boolean) {
    return concat(
      of(this.userForm.get(path).value),
      this.userForm.get(path).valueChanges,
    ).pipe(map(decider));
  }
  private isHiddenIfNoProvider(providerKey: OnlineProviderType) {
    return this.observeField(
      "imageProviders",
      (selectedProviders: OnlineProviderType[]) => {
        return !selectedProviders || !selectedProviders.includes(providerKey);
      },
    );
  }
  private isHiddenIfNotRomsParser() {
    return this.observeField(
      "parserType",
      (pType: ParserType) =>
        !pType || parserInfo.superTypesMap[pType] !== parserInfo.ROMType,
    );
  }
  private isHiddenIfArtworkOnlyParser() {
    return this.observeField(
      "parserType",
      (pType: ParserType) =>
        !pType ||
        parserInfo.superTypesMap[pType] === parserInfo.ArtworkOnlyType,
    );
  }

  private isHiddenIfNoParserInputs() {
    return this.observeField("parserType", (pType: ParserType) => {
      return !pType || !parserInfo.availableParserInputs[pType].length;
    });
  }

  private loadConfiguration() {
    if (
      this.configurationIndex !== -1 &&
      this.userConfigurations.length > this.configurationIndex
    ) {
      let config = this.userConfigurations[this.configurationIndex];

      this.formChanges.unsubscribe();
      this.userForm.patchValue(
        _.cloneDeep(config.current ? config.current : config.saved),
      );
      this.markAsDirtyDeep(this.userForm);

      this.isUnsaved = config.current != null;

      this.formChanges = this.userForm.valueChanges.subscribe(
        (data: UserConfiguration) => {
          if (config.current == null)
            this.parsersService.setCurrentConfiguration(
              this.configurationIndex,
              data,
            );
          else config.current = data;
        },
      );
      this.loadedIndex = this.configurationIndex;
    } else if (
      this.configurationIndex === -1 &&
      this.userConfigurations !== undefined
    ) {
      this.formChanges.unsubscribe();
      this.userForm.patchValue({ parserInputs: null });
      this.userForm.patchValue(this.parsersService.getDefaultValues());
      this.userForm.markAsPristine();
      this.loadedIndex = -1;
    } else {
      this.loadedIndex = null;
    }

    this.changeRef.detectChanges();
  }

  private markAsDirtyDeep(control: FormGroup): void {
    control.markAsDirty();
    if (control["controls"] !== undefined) {
      for (let childKey in control.controls) {
        this.markAsDirtyDeep(control.get(childKey) as FormGroup);
      }
    }
  }

  private highlight(input: string, tag: string) {
    let output = "";
    if (this.vParser.setInput(input).parse()) {
      this.vParser.traverseAST((ast, item, level, passedData: string[]) => {
        if (level === 0) {
          if (item.type === "string") {
            output += ast.input.substring(item.range.start, item.range.end);
          } else {
            let modLevel = level % 3;
            output += `<${tag} class="level-${modLevel}">${ast.leftDelimiter}</${tag}>${passedData ? passedData.join("") : ""}<${tag} class="level-${modLevel}">${ast.rightDelimiter}</${tag}>`;
          }
        } else {
          if (item.type === "string") {
            return ast.input.substring(item.range.start, item.range.end);
          } else {
            let modLevel = level % 3;
            return `<${tag} class="level-${modLevel}">${ast.leftDelimiter}</${tag}>${passedData ? passedData.join("") : ""}<${tag} class="level-${modLevel}">${ast.rightDelimiter}</${tag}>`;
          }
        }
      }, false);
    } else output = input;
    return output;
  }

  private removeControllers() {
    let configTitle = this.userForm.get("configTitle").value;
    this.loggerService.info(
      this.lang.info.removingControllers__i.interpolate({
        configTitle: configTitle,
      }),
    );
    let steamDirInput = this.userForm.get("steamDirectory").value || "";
    let steamDir = this.parsersService.parseSteamDir(steamDirInput);
    if (this.parsersService.validate("steamDirectory", steamDir) == null) {
      let userAccountsInfo = this.userForm.get("userAccounts").value;
      let parserId = this.parsersService.getParserId(this.configurationIndex);
      this.parsersService
        .parseUserAccounts(userAccountsInfo, steamDir)
        .then((userIds) => {
          for (let userId of userIds) {
            this.parsersService.removeControllers(steamDir, userId, parserId);
          }
          this.loggerService.success(
            this.lang.success.removedControllers__i.interpolate({
              configTitle: configTitle,
            }),
            { invokeAlert: true, alertTimeout: 3000 },
          );
        })
        .catch((error) => {
          this.loggerService.error(this.lang.error.errorRemovingControllers, {
            invokeAlert: true,
            alertTimeout: 3000,
          });
          this.loggerService.error(error);
        });
    } else {
      this.loggerService.error(this.lang.error.cannotRemoveControllers, {
        invokeAlert: true,
        alertTimeout: 3000,
      });
    }
  }

  private async fetchControllerTemplates(force: boolean = true) {
    if (force) {
      this.loggerService.info(this.lang.info.fetchingControllerTemplates);
    }
    let steamDirInput = this.userForm.get("steamDirectory").value || "";
    let steamDir = this.parsersService.parseSteamDir(steamDirInput);
    if (this.parsersService.validate("steamDirectory", steamDir) == null) {
      if (force || !this.parsersService.controllerTemplates[steamDir]) {
        this.parsersService.controllerTemplates[steamDir] = {};
        for (let controllerType of controllerTypes) {
          this.parsersService.controllerTemplates[steamDir][controllerType] =
            await this.parsersService.getControllerTemplates(
              steamDir,
              controllerType,
            );
        }
        this.parsersService.saveControllerTemplates();
      }
      for (let controllerType of Object.keys(
        this.parsersService.controllerTemplates[steamDir],
      )) {
        (
          (this.nestedGroup.children.controllers as NestedFormElement.Group)
            .children[controllerType] as NestedFormElement.Select
        ).values = this.parsersService.controllerTemplates[steamDir][
          controllerType
        ].map((template) => {
          return { displayValue: template.title, value: template };
        });
      }
      if (force) {
        this.loggerService.success(this.lang.success.fetchedTemplates, {
          invokeAlert: true,
          alertTimeout: 3000,
        });
      }
    } else if (force) {
      this.loggerService.error(this.lang.error.cannotFetchTemplates, {
        invokeAlert: true,
        alertTimeout: 3000,
      });
    }
  }
}
