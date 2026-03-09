/**
 * Collapsible section wrapper component.
 */

export interface SectionProps {
  id: string;
  title?: string;
  collapsible: boolean;
  children: HTMLElement[];
}

export function createSection(props: SectionProps): HTMLElement {
  const { id, title, collapsible, children } = props;

  const section = document.createElement('fieldset');
  section.className = 'form-section';
  section.id = `section-${id}`;

  if (title) {
    const legend = document.createElement('legend');
    legend.className = 'section-title';

    if (collapsible) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'section-toggle';
      toggle.textContent = `▸ ${title}`;
      let collapsed = true;

      const content = document.createElement('div');
      content.className = 'section-content collapsed';
      for (const child of children) content.appendChild(child);

      toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        toggle.textContent = `${collapsed ? '▸' : '▾'} ${title}`;
        content.classList.toggle('collapsed', collapsed);
      });

      legend.appendChild(toggle);
      section.appendChild(legend);
      section.appendChild(content);
    } else {
      legend.textContent = title;
      section.appendChild(legend);
      for (const child of children) section.appendChild(child);
    }
  } else {
    for (const child of children) section.appendChild(child);
  }

  return section;
}
