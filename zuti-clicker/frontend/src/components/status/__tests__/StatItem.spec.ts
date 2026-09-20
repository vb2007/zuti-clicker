import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatItem from "@/components/status/StatItem.vue";

describe("StatItem", () => {
  it("renders label and value", () => {
    const wrapper = mount(StatItem, { props: { label: "Per Second", value: "12.0/s" } });
    expect(wrapper.find(".stat-label").text()).toBe("Per Second");
    expect(wrapper.find(".stat-value").text()).toBe("12.0/s");
  });

  it("shows no badge and no boosted styling by default", () => {
    const wrapper = mount(StatItem, { props: { label: "Per Second", value: "12.0/s" } });
    expect(wrapper.find(".stat-badge").exists()).toBe(false);
    expect(wrapper.classes()).not.toContain("boosted");
  });

  it("shows the badge and boosted styling when boosted", () => {
    const wrapper = mount(StatItem, {
      props: { label: "Per Click", value: "+847", boosted: true, badge: "×7" }
    });
    const badge = wrapper.find(".stat-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("×7");
    expect(wrapper.find(".stat-item").classes()).toContain("boosted");
  });

  // boosted without a badge (shouldn't normally happen, but the template
  // guards `boosted && badge` explicitly) must still render safely.
  it("does not render a badge if boosted is true but no badge text is given", () => {
    const wrapper = mount(StatItem, { props: { label: "Per Click", value: "+847", boosted: true } });
    expect(wrapper.find(".stat-badge").exists()).toBe(false);
  });

  it("primary styling still applies independently of boosted", () => {
    const wrapper = mount(StatItem, {
      props: { label: "PhDs Earned", value: "2", primary: true }
    });
    expect(wrapper.find(".stat-item").classes()).toContain("primary");
  });
});
