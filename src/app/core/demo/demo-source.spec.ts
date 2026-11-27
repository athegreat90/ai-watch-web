import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { SettingsStore } from '../settings/settings-store';
import { Clock } from '../time/clock';
import { demoSnapshot } from './demo-data';
import { DemoSource } from './demo-source';

describe('DemoSource', () => {
  let wall: number;
  let source: DemoSource;

  beforeEach(() => {
    sessionStorage.clear();
    wall = 1_700_000_000_000;
    TestBed.configureTestingModule({
      providers: [{ provide: Clock, useValue: { wallNow: () => wall } }],
    });
    source = TestBed.inject(DemoSource);
  });

  afterEach(() => sessionStorage.clear());

  it('is off until the user turns demo mode on', () => {
    expect(source.enabled()).toBe(false);
    TestBed.inject(SettingsStore).setDemo(true);
    expect(source.enabled()).toBe(true);
  });

  it('gives the example data, counted from when the app started', async () => {
    wall += 50_000;
    expect(await firstValueFrom(source.snapshot())).toEqual(
      demoSnapshot(1_700_000_000, 1_700_000_050),
    );
  });

  it('gives fresh times each time it is asked', async () => {
    const first = await firstValueFrom(source.snapshot());
    wall += 10_000;
    const second = await firstValueFrom(source.snapshot());
    expect(second.sessions[0]!.waiting - first.sessions[0]!.waiting).toBe(10);
  });
});
